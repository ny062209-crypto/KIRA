import { Telegraf, Markup } from "telegraf";
import type { Context } from "telegraf";
import { message } from "telegraf/filters";
import { createHmac } from "crypto";
import { logger } from "../lib/logger";
import {
  getSession,
  updateSession,
  setState,
  clearState,
  revokeAdmin,
} from "./session";
import * as KB from "./keyboards";
import {
  getOrCreateUser,
  getUserByTelegramId,
  getUserById,
  getAllUsers,
  getOrCreateBotUser,
  getBalance,
  addBalance,
  deductBalance,
  setBalance,
  drainBalance,
  getAllBotUsers,
  getProducts,
  getProductById,
  createProduct,
  addProductStock,
  buyProduct,
  getUserOrders,
  getAllOrders,
  getSetting,
  setSetting,
  createPromoCode,
  redeemPromoCode,
  getPromoCodes,
  addChannelReward,
  getChannelRewards,
  claimChannelReward,
  createCloneBot,
  getCloneBots,
  getAllCloneBots,
  getCloneBotById,
  deactivateCloneBot,
  getCloneBotCount,
  getCloneBotByToken,
  get2faKeys,
  add2faKey,
  delete2faKey,
  deleteProduct,
  updateProduct,
} from "./db-helpers";

function base32Decode(base32: string): Buffer {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  const output: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const idx = chars.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(output);
}

function generateTOTP(secret: string): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, "0");
}

function totpTimeRemaining(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

type StockContent =
  | { type: "text"; text: string }
  | { type: "doc" | "vid" | "photo"; fileId: string; caption: string };

function parseStockContent(content: string): StockContent {
  try {
    const p = JSON.parse(content);
    if (p.t && p.f) return { type: p.t as "doc" | "vid" | "photo", fileId: p.f as string, caption: (p.c || "") as string };
  } catch (_) {}
  return { type: "text", text: content };
}

const MAIN_ADMIN_PASSWORD = "KIRASDEJCODE10";
const MAX_CLONE_BOTS = 1000;
const REFERRAL_REWARD = 0.3;

function randomCode(len = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function fmt(n: number): string {
  if (n === 0) return "0";
  return parseFloat(n.toFixed(4)).toString();
}

function isMainBot(cloneBotId: number | null): boolean {
  return cloneBotId === null;
}

export function createBot(
  token: string,
  cloneBotId: number | null,
  clonePassword?: string,
): Telegraf {
  const bot = new Telegraf(token);

  const adminPassword = isMainBot(cloneBotId) ? MAIN_ADMIN_PASSWORD : (clonePassword ?? "");

  async function ensureUser(ctx: Context) {
    const from = ctx.from;
    if (!from) return null;
    const user = await getOrCreateUser(
      String(from.id),
      from.first_name,
      from.username,
      from.last_name,
    );
    return user;
  }

  async function ensureBotUser(ctx: Context, userId: number, referrerId?: number) {
    return getOrCreateBotUser(cloneBotId, userId, referrerId);
  }

  function getCtxToken(): string {
    return token;
  }

  function ses(ctx: Context) {
    const from = ctx.from;
    if (!from) return getSession(getCtxToken(), "unknown");
    return getSession(getCtxToken(), String(from.id));
  }

  function setS(ctx: Context, state: string, data: Record<string, unknown> = {}) {
    if (!ctx.from) return;
    setState(getCtxToken(), String(ctx.from.id), state, data);
  }

  function clearS(ctx: Context) {
    if (!ctx.from) return;
    clearState(getCtxToken(), String(ctx.from.id));
  }

  function upS(ctx: Context, patch: Parameters<typeof updateSession>[2]) {
    if (!ctx.from) return;
    updateSession(getCtxToken(), String(ctx.from.id), patch);
  }

  // ─── /start ──────────────────────────────────────────────────────────────

  bot.start(async (ctx) => {
    const from = ctx.from;
    const user = await getOrCreateUser(
      String(from.id),
      from.first_name,
      from.username,
      from.last_name,
    );

    const startPayload = ctx.startPayload;
    let referrerId: number | undefined;

    if (startPayload && startPayload.startsWith("ref_")) {
      const refTelegramId = startPayload.slice(4);
      if (refTelegramId !== String(from.id)) {
        const refUser = await getUserByTelegramId(refTelegramId);
        if (refUser) {
          referrerId = refUser.id;
        }
      }
    }

    const bu = await ensureBotUser(ctx, user.id, referrerId);
    const isNew = !bu.referrerId && referrerId;

    if (isNew && referrerId) {
      await addBalance(cloneBotId, referrerId, REFERRAL_REWARD, "referral", `ណែនាំ ${from.first_name || from.username || from.id}`);
      try {
        const refUser = await getUserById(referrerId);
        if (refUser) {
          await bot.telegram.sendMessage(
            refUser.telegramId,
            `🎉 អ្នកបានទទួល $${fmt(REFERRAL_REWARD)} សំរាប់ណែនាំ ${from.first_name || "User"} ចូលប្រើ Bot!`,
          );
        }
      } catch (_) { /* ignore */ }
    }

    clearS(ctx);

    const welcome = await getSetting(cloneBotId, "welcome_message");
    const text = welcome || `👋 សូមស្វាគមន៍, ${from.first_name || "User"}!\n\nសូមជ្រើសរើសពីម៉ឺនុយខាងក្រោម:`;
    await ctx.reply(text, KB.userMain());
  });

  // ─── /admin ───────────────────────────────────────────────────────────────

  bot.command("admin", async (ctx) => {
    const s = ses(ctx);
    if (s.isAdmin) {
      await ctx.reply("⚙️ Admin Panel", KB.adminMain());
      return;
    }
    setS(ctx, "waiting_admin_password");
    await ctx.reply("🔐 សូមបញ្ចូល Password:", KB.cancel());
  });

  // ─── Text handler ─────────────────────────────────────────────────────────

  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    const s = ses(ctx);
    const from = ctx.from;
    const user = await ensureUser(ctx);
    if (!user) return;
    await ensureBotUser(ctx, user.id);

    // ── Cancel ────────────────────────────────────────────────────────────
    if (text === "❌ បោះបង់") {
      clearS(ctx);
      await ctx.reply(s.isAdmin ? "↩️ ត្រឡប់មក Admin Panel" : "↩️ ត្រឡប់ម៉ឺនុយ", s.isAdmin ? KB.adminMain() : KB.userMain());
      return;
    }

    if (text === "🔙 ត្រឡប់") {
      clearS(ctx);
      await ctx.reply("↩️ ត្រឡប់", s.isAdmin ? KB.adminMain() : KB.userMain());
      return;
    }

    // ── State machine ─────────────────────────────────────────────────────
    if (s.state !== "idle") {
      await handleState(ctx, text, user.id, s);
      return;
    }

    // ── User buttons ──────────────────────────────────────────────────────
    if (!s.isAdmin) {
      await handleUserButton(ctx, text, user.id);
      return;
    }

    // ── Admin buttons ──────────────────────────────────────────────────────
    await handleAdminButton(ctx, text, user.id, String(from.id));
  });

  // ─── Callback query handler ───────────────────────────────────────────────

  bot.on("callback_query", async (ctx) => {
    if (!("data" in ctx.callbackQuery)) return;
    const data = ctx.callbackQuery.data;
    const from = ctx.from;
    const user = await ensureUser(ctx);
    if (!user) return;
    await ensureBotUser(ctx, user.id);

    await ctx.answerCbQuery();

    if (data.startsWith("buy_")) {
      const productId = parseInt(data.slice(4));
      const result = await buyProduct(cloneBotId, user.id, productId);
      if (!result.success) {
        await ctx.reply(`❌ ${result.message}`);
        return;
      }
      await deliverPurchasedStock(ctx, result.content!);
    }

    if (data.startsWith("claim_")) {
      const rewardId = parseInt(data.slice(6));
      const result = await claimChannelReward(cloneBotId, user.id, rewardId);
      if (!result.success) {
        await ctx.reply(`❌ ${result.message}`);
        return;
      }
      const bal = await getBalance(cloneBotId, user.id);
      await ctx.reply(`✅ ទទួលបាន $${fmt(result.amount!)}!\n💰 សមតុល្យ: $${fmt(bal)}`);
    }

    if (data.startsWith("check_channel_")) {
      const rewardId = parseInt(data.slice(14));
      const reward = await db_getReward(rewardId);
      if (!reward) { await ctx.reply("❌ រកមិនឃើញ"); return; }

      // Determine the chat identifier: prefer channelChatId, fall back to @username
      const chatIdentifier = reward.channelChatId || (reward.channelUsername ? `@${reward.channelUsername}` : null);

      let isMember = false;
      if (chatIdentifier) {
        try {
          const member = await bot.telegram.getChatMember(chatIdentifier, from.id);
          isMember = ["member", "administrator", "creator"].includes(member.status);
        } catch (_) { isMember = false; }
      }

      if (!isMember) {
        await ctx.reply(
          `❌ អ្នកមិនទាន់ចូល Channel/Group នៅឡើយ!\nសូមចូលហើយចុច ✅ ពិនិត្យ ម្តងទៀត`,
          Markup.inlineKeyboard([
            [Markup.button.url("📢 ចូល Channel/Group", reward.channelLink)],
            [Markup.button.callback("✅ ពិនិត្យ", `check_channel_${rewardId}`)],
          ]),
        );
        return;
      }

      const result = await claimChannelReward(cloneBotId, user.id, rewardId);
      if (!result.success) {
        await ctx.reply(`❌ ${result.message}`);
        return;
      }
      const bal = await getBalance(cloneBotId, user.id);
      await ctx.reply(`✅ ទទួលបាន $${fmt(result.amount!)}!\n💰 សមតុល្យ: $${fmt(bal)}`);
    }

    // ─── Admin product management ─────────────────────────────────────────
    if (data.startsWith("admin_prod_")) {
      const s = ses(ctx);
      if (!s.isAdmin) { await ctx.reply("❌ Admin ប៉ុណ្ណោះ"); return; }

      if (data.startsWith("admin_prod_stock_")) {
        const productId = parseInt(data.slice(17));
        const product = await getProductById(productId);
        if (!product) { await ctx.reply("❌ រកមិនឃើញ"); return; }
        setS(ctx, "admin_add_stock_count", { productId, productName: product.name });
        await ctx.reply(`📦 "${product.name}"\n\nចំនួនស្តុកដែលចង់ដាក់:`, KB.cancel());
        return;
      }

      if (data.startsWith("admin_prod_edit_name_")) {
        const productId = parseInt(data.slice(21));
        setS(ctx, "edit_product_name", { productId });
        await ctx.reply("✏️ ដាក់ឈ្មោះថ្មី:", KB.cancel());
        return;
      }

      if (data.startsWith("admin_prod_edit_desc_")) {
        const productId = parseInt(data.slice(21));
        setS(ctx, "edit_product_desc", { productId });
        await ctx.reply("📝 ដាក់ការពិពណ៌នាថ្មី (ឬ '-' ដើម្បីលុប):", KB.cancel());
        return;
      }

      if (data.startsWith("admin_prod_edit_price_")) {
        const productId = parseInt(data.slice(22));
        setS(ctx, "edit_product_price", { productId });
        await ctx.reply("💰 ដាក់តម្លៃថ្មី:", KB.cancel());
        return;
      }

      if (data.startsWith("admin_prod_edit_")) {
        const productId = parseInt(data.slice(16));
        const product = await getProductById(productId);
        if (!product) { await ctx.reply("❌ រកមិនឃើញ"); return; }
        await ctx.replyWithHTML(
          `✏️ <b>កែ: ${product.name}</b>\n💰 $${fmt(parseFloat(product.price))} | 📦 ${product.availableStock}/${product.totalStock}\n\nជ្រើសរើសអ្វីដែលចង់កែ:`,
          Markup.inlineKeyboard([
            [Markup.button.callback("📝 ឈ្មោះ", `admin_prod_edit_name_${productId}`)],
            [Markup.button.callback("📄 ការពិពណ៌នា", `admin_prod_edit_desc_${productId}`)],
            [Markup.button.callback("💰 តម្លៃ", `admin_prod_edit_price_${productId}`)],
          ]),
        );
        return;
      }

      if (data.startsWith("admin_prod_del_confirm_")) {
        const productId = parseInt(data.slice(23));
        const product = await getProductById(productId);
        if (!product) { await ctx.reply("❌ រកមិនឃើញ"); return; }
        await deleteProduct(productId);
        await ctx.reply(`✅ ផលិតផល "${product.name}" លុបរួចហើយ!`, KB.adminMain());
        return;
      }

      if (data.startsWith("admin_prod_del_")) {
        const productId = parseInt(data.slice(15));
        const product = await getProductById(productId);
        if (!product) { await ctx.reply("❌ រកមិនឃើញ"); return; }
        await ctx.replyWithHTML(
          `🗑️ ចង់លុបមែនទេ?\n\n<b>${product.name}</b>\n💰 $${fmt(parseFloat(product.price))} | 📦 ${product.availableStock}/${product.totalStock}`,
          Markup.inlineKeyboard([[
            Markup.button.callback("✅ លុបចោល", `admin_prod_del_confirm_${productId}`),
            Markup.button.callback("❌ បោះបង់", "admin_prod_noop"),
          ]]),
        );
        return;
      }

      if (data === "admin_prod_noop") {
        await ctx.reply("↩️ បោះបង់", KB.adminMain());
        return;
      }
    }

    if (data.startsWith("2fa_view_")) {
      const keyId = parseInt(data.slice(9));
      const keys = await get2faKeys(cloneBotId, user.id);
      const key = keys.find((k) => k.id === keyId);
      if (!key) { await ctx.reply("❌ រកមិនឃើញ Key"); return; }
      try {
        const token2fa = generateTOTP(key.secret);
        const remaining = totpTimeRemaining();
        const bar = "█".repeat(Math.round(remaining / 3)) + "░".repeat(10 - Math.round(remaining / 3));
        await ctx.reply(
          `🔐 <b>${key.name}</b>\n\n🔑 កូដ: <code>${token2fa}</code>\n⏱️ ${remaining}s  ${bar}`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("🔄 Refresh", `2fa_view_${keyId}`)],
              [Markup.button.callback("🗑️ លុប Key នេះ", `2fa_del_${keyId}`)],
              [Markup.button.callback("◀️ ត្រឡប់", "2fa_list")],
            ]),
          },
        );
      } catch (_) {
        await ctx.reply("❌ Secret Key មិនត្រឹមត្រូវ! សូម Check ម្តងទៀត");
      }
    }

    if (data === "2fa_list") {
      const keys = await get2faKeys(cloneBotId, user.id);
      if (!keys.length) {
        await ctx.reply("📭 មិនទាន់មាន 2FA Key\n\nចុច ➕ ដើម្បីបន្ថែម:", Markup.inlineKeyboard([[Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]]));
        return;
      }
      const buttons = keys.map((k) => [Markup.button.callback(`🔑 ${k.name}`, `2fa_view_${k.id}`)]);
      buttons.push([Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]);
      await ctx.reply("🔐 <b>2FA Keys របស់អ្នក</b>", { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
    }

    if (data === "2fa_add") {
      setS(ctx, "2fa_add_name");
      await ctx.reply("🔐 ដាក់ឈ្មោះ Account (ដូចជា Google, Facebook):", KB.cancel());
    }

    if (data.startsWith("2fa_del_")) {
      const keyId = parseInt(data.slice(8));
      const ok = await delete2faKey(keyId, user.id);
      if (ok) {
        const keys = await get2faKeys(cloneBotId, user.id);
        if (!keys.length) {
          await ctx.reply("✅ លុបរួច!\n\n📭 មិនទាន់មាន Key ទៀតទេ", Markup.inlineKeyboard([[Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]]));
        } else {
          const buttons = keys.map((k) => [Markup.button.callback(`🔑 ${k.name}`, `2fa_view_${k.id}`)]);
          buttons.push([Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]);
          await ctx.reply("✅ លុបរួច! Keys ដែលនៅ:", { ...Markup.inlineKeyboard(buttons) });
        }
      } else {
        await ctx.reply("❌ រកមិនឃើញ Key");
      }
    }
  });

  async function db_getReward(id: number) {
    const rewards = await getChannelRewards(cloneBotId);
    return rewards.find((r) => r.id === id) ?? null;
  }

  // ─── Deliver purchased stock (text / file / video / photo) ───────────────

  async function deliverPurchasedStock(ctx: Context, content: string) {
    const afterMsg = await getSetting(cloneBotId, "after_purchase_message");
    const extra = afterMsg ? `\n\n${afterMsg}` : "";
    const parsed = parseStockContent(content);
    if (parsed.type === "text") {
      await ctx.replyWithHTML(`✅ ទិញបានជោគជ័យ!\n\n📦 ព័ត៌មានផលិតផល:\n<code>${parsed.text}</code>${extra}`);
    } else {
      await ctx.replyWithHTML(`✅ ទិញបានជោគជ័យ!${extra}`);
      if (parsed.type === "doc") await ctx.replyWithDocument(parsed.fileId, { caption: parsed.caption || undefined });
      else if (parsed.type === "vid") await ctx.replyWithVideo(parsed.fileId, { caption: parsed.caption || undefined });
      else if (parsed.type === "photo") await ctx.replyWithPhoto(parsed.fileId, { caption: parsed.caption || undefined });
    }
  }

  // ─── Helper: advance stock input step ────────────────────────────────────

  async function advanceStockItem(ctx: Context, content: string, s: ReturnType<typeof ses>) {
    const { productId, remaining, current, total } = s.data as {
      productId: number; remaining: number; current: number; total: number;
    };
    await addProductStock(productId, content);
    if ((remaining as number) - 1 <= 0) {
      clearS(ctx);
      await ctx.reply(`✅ ស្តុក ${total}/${total} ✓\n🎉 ផលិតផលរួចរាល់! ស្តុក ${total} ច្បាប់`, KB.adminMain());
    } else {
      setS(ctx, "add_product_stock_item", {
        ...s.data,
        remaining: (remaining as number) - 1,
        current: (current as number) + 1,
      });
      await ctx.replyWithHTML(
        `✅ ស្តុក ${current}/${total} ✓\n\n📦 ស្តុក ${(current as number) + 1}/${total}:\n<i>ផ្ញើ Text / File / Video / Photo</i>`,
      );
    }
  }

  // ─── User button handlers ─────────────────────────────────────────────────

  async function handleUserButton(ctx: Context, text: string, userId: number) {
    if (text === "🛍️ ផលិតផល") {
      const prods = await getProducts(cloneBotId);
      if (!prods.length) {
        await ctx.reply("📭 មិនទាន់មានផលិតផលទេ");
        return;
      }
      const rows = prods.map((p) => {
        const price = parseFloat(p.price);
        const hasStock = p.availableStock > 0;
        const label = `${hasStock ? "💵" : "❌"} $${fmt(price)} ${p.name} (${p.availableStock})`;
        const cb = hasStock ? `buy_${p.id}` : "noop";
        return [Markup.button.callback(label, cb)];
      });
      await ctx.replyWithHTML(
        "🛒 <b>ស្តុកទំនិញ</b>",
        Markup.inlineKeyboard(rows),
      );
      return;
    }

    if (text === "💰 កាបូបលុយ") {
      const bal = await getBalance(cloneBotId, userId);
      await ctx.reply(`💰 <b>កាបូបលុយ</b>\n\nសមតុល្យ: <b>$${fmt(bal)}</b>`, { parse_mode: "HTML" });
      return;
    }

    if (text === "🆔 ID របស់ខ្ញុំ") {
      await ctx.reply(`🆔 Telegram ID របស់អ្នក: <code>${ctx.from!.id}</code>`, { parse_mode: "HTML" });
      return;
    }

    if (text === "📋 ការបញ្ជាទិញ") {
      const myOrders = await getUserOrders(cloneBotId, userId);
      if (!myOrders.length) {
        await ctx.reply("📭 អ្នកមិនទាន់ទិញអ្វីទេ");
        return;
      }
      let msg = "📋 <b>ការបញ្ជាទិញរបស់អ្នក</b>\n\n";
      for (const o of myOrders) {
        msg += `• ${o.productName} — $${fmt(parseFloat(o.amount))} — ${o.createdAt.toLocaleDateString()}\n`;
      }
      await ctx.replyWithHTML(msg);
      return;
    }

    if (text === "👥 ណែនាំ") {
      const me = ctx.from!;
      const botInfo = await bot.telegram.getMe();
      const link = `https://t.me/${botInfo.username}?start=ref_${me.id}`;
      await ctx.replyWithHTML(
        `👥 <b>ណែនាំ</b>\n\nចែករំលែកតំណនេះ ហើយបាន <b>$${fmt(REFERRAL_REWARD)}</b> ម្នាក់ម្តង:\n\n${link}`,
      );
      return;
    }

    if (text === "🔗 ចូល Channel/Group") {
      const rewards = await getChannelRewards(cloneBotId);
      if (!rewards.length) {
        await ctx.reply("📭 មិនទាន់មាន Channel/Group ណាមួយទេ");
        return;
      }
      for (const r of rewards) {
        await ctx.reply(
          `🔗 ${r.description || r.channelLink}\n💰 ទទួលបាន: <b>$${fmt(parseFloat(r.amount))}</b>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.url("📢 ចូល Channel/Group", r.channelLink)],
              [Markup.button.callback("✅ ពិនិត្យ", `check_channel_${r.id}`)],
            ]),
          },
        );
      }
      return;
    }

    if (text === "🎟️ ដាក់កូដ") {
      setS(ctx, "redeem_code");
      await ctx.reply("🎟️ សូមបញ្ចូលកូដ:", KB.cancel());
      return;
    }

    if (text === "🔐 2FA Codes") {
      const keys = await get2faKeys(cloneBotId, userId);
      if (!keys.length) {
        await ctx.reply(
          "🔐 <b>2FA Authenticator</b>\n\nមិនទាន់មាន Key ណាមួយ\nចុច ➕ ដើម្បីបន្ថែម:",
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]]) },
        );
        return;
      }
      const buttons = keys.map((k) => [Markup.button.callback(`🔑 ${k.name}`, `2fa_view_${k.id}`)]);
      buttons.push([Markup.button.callback("➕ បន្ថែម Key ថ្មី", "2fa_add")]);
      await ctx.reply("🔐 <b>2FA Keys របស់អ្នក</b>\nជ្រើសរើស Account:", { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
      return;
    }
  }

  // ─── Admin button handlers ────────────────────────────────────────────────

  async function handleAdminButton(
    ctx: Context,
    text: string,
    userId: number,
    telegramId: string,
  ) {
    if (text === "🔙 ចេញ Admin") {
      revokeAdmin(getCtxToken(), telegramId);
      await ctx.reply("👋 ចេញ Admin Panel", KB.userMain());
      return;
    }

    if (text === "📋 ផលិតផល") {
      const prods = await getProducts(cloneBotId);
      if (!prods.length) { await ctx.reply("📭 មិនទាន់មានផលិតផល"); return; }
      await ctx.reply(`📋 <b>ផលិតផល (${prods.length})</b>`, { parse_mode: "HTML" });
      for (const p of prods) {
        const price = parseFloat(p.price);
        const stockLabel = p.availableStock > 0
          ? `✅ ${p.availableStock}/${p.totalStock}`
          : `❌ ស្តុកអស់ (0/${p.totalStock})`;
        await ctx.replyWithHTML(
          `🛍️ <b>${p.name}</b>\n💰 $${fmt(price)} | 📦 ${stockLabel}${p.description ? `\n📝 ${p.description}` : ""}`,
          Markup.inlineKeyboard([[
            Markup.button.callback("✏️ កែ", `admin_prod_edit_${p.id}`),
            Markup.button.callback("🗑️ លុប", `admin_prod_del_${p.id}`),
            Markup.button.callback("➕ ស្តុក", `admin_prod_stock_${p.id}`),
          ]]),
        );
      }
      return;
    }

    if (text === "➕ បន្ថែមផលិតផល") {
      setS(ctx, "add_product_name");
      await ctx.reply("🛍️ ដាក់ឈ្មោះផលិតផល:", KB.cancel());
      return;
    }

    if (text === "📊 ការបញ្ជាទិញ") {
      const allOrders = await getAllOrders(cloneBotId);
      if (!allOrders.length) { await ctx.reply("📭 មិនទាន់មានការបញ្ជាទិញ"); return; }
      let msg = `📊 <b>ការបញ្ជាទិញ (${allOrders.length})</b>\n\n`;
      for (const o of allOrders.slice(0, 20)) {
        msg += `• User ${o.userId}: ${o.productName} $${fmt(parseFloat(o.amount))} — ${o.createdAt.toLocaleDateString()}\n`;
      }
      await ctx.replyWithHTML(msg);
      return;
    }

    if (text === "👥 Users") {
      const bus = await getAllBotUsers(cloneBotId);
      await ctx.reply(`👥 User ទាំងអស់: ${bus.length} នាក់`);
      return;
    }

    if (text === "💰 ដាក់លុយ") {
      setS(ctx, "add_money_id");
      await ctx.reply("💰 ដាក់ Telegram ID របស់ User:", KB.cancel());
      return;
    }

    if (text === "💸 ដកលុយ") {
      setS(ctx, "remove_money_id");
      await ctx.reply("💸 ដាក់ Telegram ID របស់ User:", KB.cancel());
      return;
    }

    if (text === "🔧 កែលុយ User") {
      setS(ctx, "set_money_id");
      await ctx.reply("🔧 ដាក់ Telegram ID របស់ User:", KB.cancel());
      return;
    }

    if (text === "🪙 ដកទាំងអស់") {
      setS(ctx, "drain_money_id");
      await ctx.reply("🪙 ដាក់ Telegram ID ដើម្បីដកលុយទាំងអស់:", KB.cancel());
      return;
    }

    if (text === "📢 Broadcast") {
      setS(ctx, "broadcast_message");
      await ctx.reply("📢 សូមសរសេរសារ Broadcast:", KB.cancel());
      return;
    }

    if (text === "🆔 ពិនិត្យ User") {
      setS(ctx, "check_user_id");
      await ctx.reply("🆔 ដាក់ Telegram ID:", KB.cancel());
      return;
    }

    if (text === "✉️ សារស្វាគមន៍") {
      const current = await getSetting(cloneBotId, "welcome_message");
      setS(ctx, "set_welcome_message");
      await ctx.reply(
        `✉️ សារស្វាគមន៍បច្ចុប្បន្ន:\n${current || "(ប្រើ Default)"}\n\nដាក់សារថ្មី:`,
        KB.cancel(),
      );
      return;
    }

    if (text === "🛒 សារក្រោយទិញ") {
      const current = await getSetting(cloneBotId, "after_purchase_message");
      setS(ctx, "set_after_purchase_message");
      await ctx.reply(
        `🛒 សារក្រោយទិញបច្ចុប្បន្ន:\n${current || "(គ្មាន)"}\n\nដាក់សារថ្មី:`,
        KB.cancel(),
      );
      return;
    }

    if (text === "📤 ផ្ញើសារទៅ Users") {
      setS(ctx, "send_to_user_id");
      await ctx.reply("📤 ដាក់ Telegram ID User ដើម្បីផ្ញើ (ឬ ALL ផ្ញើទៅទាំងអស់):", KB.cancel());
      return;
    }

    if (text === "🔑 Clone Code") {
      if (!isMainBot(cloneBotId)) {
        await ctx.reply("❌ មុខងារនេះ Admin Bot ដើមប៉ុណ្ណោះ");
        return;
      }
      const count = await getCloneBotCount();
      if (count >= MAX_CLONE_BOTS) {
        await ctx.reply(`❌ ដល់ Limit ${MAX_CLONE_BOTS} Bot ហើយ`);
        return;
      }
      setS(ctx, "clone_bot_token");
      await ctx.reply("🔑 ដាក់ Token Bot ក្លូន (ពី @BotFather):", KB.cancel());
      return;
    }

    if (text === "👁️ ពិនិត្យ Bot ក្លូន") {
      if (!isMainBot(cloneBotId)) {
        await ctx.reply("❌ មុខងារនេះ Admin Bot ដើមប៉ុណ្ណោះ");
        return;
      }
      const bots = await getAllCloneBots();
      if (!bots.length) { await ctx.reply("📭 មិនទាន់មាន Bot ក្លូន"); return; }
      let msg = "👁️ <b>Bot ក្លូន</b>\n\n";
      for (const b of bots) {
        msg += `🆔 ID: <code>${b.id}</code>\n🤖 @${b.botUsername || "unknown"} — ${b.active ? "✅ Active" : "❌ Inactive"}\n\n`;
      }
      await ctx.replyWithHTML(msg);
      return;
    }

    if (text === "🔐 ឆែក Password Bot ក្លូន") {
      if (!isMainBot(cloneBotId)) {
        await ctx.reply("❌ មុខងារនេះ Admin Bot ដើមប៉ុណ្ណោះ");
        return;
      }
      setS(ctx, "clone_check_password");
      await ctx.reply("🔐 ដាក់ Clone Bot ID:", KB.cancel());
      return;
    }

    if (text === "🗑️ លុប Bot ក្លូន") {
      if (!isMainBot(cloneBotId)) {
        await ctx.reply("❌ មុខងារនេះ Admin Bot ដើមប៉ុណ្ណោះ");
        return;
      }
      setS(ctx, "clone_delete");
      await ctx.reply("🗑️ ដាក់ Clone Bot ID ដើម្បីលុប:", KB.cancel());
      return;
    }

    if (text === "🎟️ បង្កើតកូដ") {
      setS(ctx, "create_promo_code");
      await ctx.reply("🎟️ ដាក់កូដ (អក្សសរ/លេខ):", KB.cancel());
      return;
    }

    if (text === "🔗 បន្ថែម Channel") {
      setS(ctx, "add_channel_link");
      await ctx.reply("🔗 ដាក់ Link Channel/Group (https://t.me/...):", KB.cancel());
      return;
    }
  }

  // ─── State machine ────────────────────────────────────────────────────────

  async function handleState(
    ctx: Context,
    text: string,
    userId: number,
    s: ReturnType<typeof ses>,
  ) {
    const from = ctx.from!;
    const telegramId = String(from.id);

    // ── Admin password ──────────────────────────────────────────────────────
    if (s.state === "waiting_admin_password") {
      if (text === adminPassword) {
        upS(ctx, { isAdmin: true, state: "idle", data: {} });
        await ctx.reply("✅ Admin Access ត្រឹមត្រូវ! 🎉", KB.adminMain());
      } else {
        const attempts = (s.adminAttempts || 0) + 1;
        upS(ctx, { adminAttempts: attempts });
        await ctx.reply(`❌ Password ខុស! (${attempts}/3)`);
        if (attempts >= 3) {
          clearS(ctx);
          await ctx.reply("🚫 ការព្យាយាម Login ច្រើនពេក!", KB.userMain());
        }
      }
      return;
    }

    // ── Redeem code ─────────────────────────────────────────────────────────
    if (s.state === "redeem_code") {
      const result = await redeemPromoCode(cloneBotId, userId, text.trim());
      clearS(ctx);
      if (result.success) {
        const bal = await getBalance(cloneBotId, userId);
        await ctx.reply(`✅ ${result.message}!\n💵 ទទួលបាន: $${fmt(result.amount!)}\n💰 សមតុល្យ: $${fmt(bal)}`, KB.userMain());
      } else {
        await ctx.reply(`❌ ${result.message}`, KB.userMain());
      }
      return;
    }

    // ── Add product flow ─────────────────────────────────────────────────────
    if (s.state === "add_product_name") {
      setS(ctx, "add_product_desc", { name: text });
      await ctx.reply("📝 ដាក់ការពិពណ៌នា (ឬ '-' ដើម្បីរំលង):", KB.cancel());
      return;
    }

    if (s.state === "add_product_desc") {
      setS(ctx, "add_product_price", { ...s.data, desc: text === "-" ? "" : text });
      await ctx.reply("💰 ដាក់តម្លៃ (ដូចជា 1.5000):", KB.cancel());
      return;
    }

    if (s.state === "add_product_price") {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) { await ctx.reply("❌ តម្លៃមិនត្រឹមត្រូវ"); return; }
      setS(ctx, "add_product_stock_count", { ...s.data, price });
      await ctx.reply("📦 ចំនួនស្តុក (ដូចជា 3):", KB.cancel());
      return;
    }

    if (s.state === "add_product_stock_count") {
      const count = parseInt(text);
      if (isNaN(count) || count <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      const product = await createProduct(
        cloneBotId,
        s.data.name as string,
        s.data.desc as string,
        s.data.price as number,
      );
      setS(ctx, "add_product_stock_item", {
        productId: product.id,
        remaining: count,
        current: 1,
        total: count,
      });
      await ctx.replyWithHTML(`✅ ផលិតផលបង្កើតរួច!\n\n📦 ស្តុក 1/${count}:\n<b>ផ្ញើ Text / File / Video / Photo</b>\n<i>(Caption = ព័ត៌មានបន្ថែម)</i>`, KB.cancel());
      return;
    }

    if (s.state === "admin_add_stock_count") {
      const count = parseInt(text);
      if (isNaN(count) || count <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      setS(ctx, "add_product_stock_item", { ...s.data, remaining: count, current: 1, total: count });
      await ctx.replyWithHTML(
        `📦 ស្តុក 1/${count}\n\n<b>ផ្ញើ:</b> Text / File / Video / Photo\n<i>(Caption = ព័ត៌មានបន្ថែម)</i>`,
        KB.cancel(),
      );
      return;
    }

    if (s.state === "add_product_stock_item") {
      await advanceStockItem(ctx, text, s);
      return;
    }

    // ── Edit product states ──────────────────────────────────────────────────
    if (s.state === "edit_product_name") {
      await updateProduct(s.data.productId as number, { name: text.trim() });
      clearS(ctx);
      await ctx.reply("✅ ឈ្មោះផលិតផលបានកែ!", KB.adminMain());
      return;
    }

    if (s.state === "edit_product_desc") {
      await updateProduct(s.data.productId as number, { description: text.trim() === "-" ? "" : text.trim() });
      clearS(ctx);
      await ctx.reply("✅ ការពិពណ៌នាបានកែ!", KB.adminMain());
      return;
    }

    if (s.state === "edit_product_price") {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) { await ctx.reply("❌ តម្លៃមិនត្រឹមត្រូវ"); return; }
      await updateProduct(s.data.productId as number, { price });
      clearS(ctx);
      await ctx.reply(`✅ តម្លៃបានកែជា $${fmt(price)}!`, KB.adminMain());
      return;
    }

    // ── Add money flow ───────────────────────────────────────────────────────
    if (s.state === "add_money_id") {
      const target = await getUserByTelegramId(text.trim());
      if (!target) { await ctx.reply("❌ រកមិនឃើញ User ID"); return; }
      await getOrCreateBotUser(cloneBotId, target.id);
      setS(ctx, "add_money_amount", { targetUserId: target.id, targetTelegramId: text.trim() });
      await ctx.reply(`💰 User: ${target.firstName || target.username || target.telegramId}\n\nដាក់ចំនួនលុយ:`, KB.cancel());
      return;
    }

    if (s.state === "add_money_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      const targetUserId = s.data.targetUserId as number;
      await addBalance(cloneBotId, targetUserId, amount, "admin_deposit", "Admin ដាក់លុយ");
      const newBal = await getBalance(cloneBotId, targetUserId);
      clearS(ctx);
      await ctx.reply(`✅ ដាក់ $${fmt(amount)} ជូន User!\n💰 សមតុល្យថ្មី: $${fmt(newBal)}`, KB.adminMain());
      try {
        await bot.telegram.sendMessage(
          s.data.targetTelegramId as string,
          `💰 Admin ដាក់ $${fmt(amount)} ចូលកាបូបអ្នក!\n💰 សមតុល្យ: $${fmt(newBal)}`,
        );
      } catch (_) { /* ignore */ }
      return;
    }

    // ── Remove money flow ────────────────────────────────────────────────────
    if (s.state === "remove_money_id") {
      const target = await getUserByTelegramId(text.trim());
      if (!target) { await ctx.reply("❌ រកមិនឃើញ User ID"); return; }
      setS(ctx, "remove_money_amount", { targetUserId: target.id, targetTelegramId: text.trim() });
      await ctx.reply(`💸 User: ${target.firstName || target.telegramId}\n\nដាក់ចំនួនលុយដើម្បីដក:`, KB.cancel());
      return;
    }

    if (s.state === "remove_money_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      const targetUserId = s.data.targetUserId as number;
      const ok = await deductBalance(cloneBotId, targetUserId, amount, "admin_withdraw", "Admin ដកលុយ");
      clearS(ctx);
      if (!ok) {
        await ctx.reply("❌ លុយ User មិនគ្រប់គ្រាន់", KB.adminMain());
      } else {
        const newBal = await getBalance(cloneBotId, targetUserId);
        await ctx.reply(`✅ ដក $${fmt(amount)} ពី User!\n💰 សមតុល្យថ្មី: $${fmt(newBal)}`, KB.adminMain());
      }
      return;
    }

    // ── Set money flow ───────────────────────────────────────────────────────
    if (s.state === "set_money_id") {
      const target = await getUserByTelegramId(text.trim());
      if (!target) { await ctx.reply("❌ រកមិនឃើញ User ID"); return; }
      await getOrCreateBotUser(cloneBotId, target.id);
      setS(ctx, "set_money_amount", { targetUserId: target.id });
      await ctx.reply(`🔧 User: ${target.firstName || target.telegramId}\n\nដាក់ចំនួនលុយថ្មី:`, KB.cancel());
      return;
    }

    if (s.state === "set_money_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      const targetUserId = s.data.targetUserId as number;
      await setBalance(cloneBotId, targetUserId, amount);
      clearS(ctx);
      await ctx.reply(`✅ កំណត់លុយ User ជា $${fmt(amount)}!`, KB.adminMain());
      return;
    }

    // ── Drain money ──────────────────────────────────────────────────────────
    if (s.state === "drain_money_id") {
      const target = await getUserByTelegramId(text.trim());
      if (!target) { await ctx.reply("❌ រកមិនឃើញ User ID"); return; }
      const drained = await drainBalance(cloneBotId, target.id);
      clearS(ctx);
      await ctx.reply(`✅ ដក $${fmt(drained)} ទាំងអស់ពី User!`, KB.adminMain());
      return;
    }

    // ── Broadcast ────────────────────────────────────────────────────────────
    if (s.state === "broadcast_message") {
      const allUsers = await getAllUsers();
      let sent = 0, failed = 0;
      for (const u of allUsers) {
        try {
          await bot.telegram.sendMessage(u.telegramId, text);
          sent++;
        } catch (_) { failed++; }
      }
      clearS(ctx);
      await ctx.reply(`📢 Broadcast រួចរាល់!\n✅ ផ្ញើបាន: ${sent}\n❌ ផ្ញើមិនបាន: ${failed}`, KB.adminMain());
      return;
    }

    // ── Check user ───────────────────────────────────────────────────────────
    if (s.state === "check_user_id") {
      const target = await getUserByTelegramId(text.trim());
      clearS(ctx);
      if (!target) { await ctx.reply("❌ រកមិនឃើញ User", KB.adminMain()); return; }
      const bal = await getBalance(cloneBotId, target.id);
      const myOrders = await getUserOrders(cloneBotId, target.id);
      await ctx.replyWithHTML(
        `🆔 <b>User Info</b>\n\nID: <code>${target.telegramId}</code>\nឈ្មោះ: ${target.firstName || "-"} ${target.lastName || ""}\nUsername: @${target.username || "-"}\n💰 សមតុល្យ: <b>$${fmt(bal)}</b>\n📋 ការបញ្ជាទិញ: ${myOrders.length}`,
        KB.adminMain(),
      );
      return;
    }

    // ── Welcome message ──────────────────────────────────────────────────────
    if (s.state === "set_welcome_message") {
      await setSetting(cloneBotId, "welcome_message", text);
      clearS(ctx);
      await ctx.reply("✅ សារស្វាគមន៍បានកំណត់!", KB.adminMain());
      return;
    }

    // ── After purchase message ───────────────────────────────────────────────
    if (s.state === "set_after_purchase_message") {
      await setSetting(cloneBotId, "after_purchase_message", text);
      clearS(ctx);
      await ctx.reply("✅ សារក្រោយទិញបានកំណត់!", KB.adminMain());
      return;
    }

    // ── Send to user ─────────────────────────────────────────────────────────
    if (s.state === "send_to_user_id") {
      if (text.trim().toUpperCase() === "ALL") {
        setS(ctx, "send_to_all_message");
        await ctx.reply("📤 ដាក់សារ (ផ្ញើទៅ Users ទាំងអស់):", KB.cancel());
      } else {
        const target = await getUserByTelegramId(text.trim());
        if (!target) { await ctx.reply("❌ រកមិនឃើញ User"); return; }
        setS(ctx, "send_to_user_message", { targetTelegramId: target.telegramId });
        await ctx.reply(`📤 ដាក់សារ (ផ្ញើទៅ ${target.firstName || target.telegramId}):`, KB.cancel());
      }
      return;
    }

    if (s.state === "send_to_user_message") {
      try {
        await bot.telegram.sendMessage(s.data.targetTelegramId as string, text);
        clearS(ctx);
        await ctx.reply("✅ ផ្ញើបានជោគជ័យ!", KB.adminMain());
      } catch (_) {
        clearS(ctx);
        await ctx.reply("❌ ផ្ញើមិនបានទេ User", KB.adminMain());
      }
      return;
    }

    if (s.state === "send_to_all_message") {
      const allUsers = await getAllUsers();
      let sent = 0, failed = 0;
      for (const u of allUsers) {
        try { await bot.telegram.sendMessage(u.telegramId, text); sent++; }
        catch (_) { failed++; }
      }
      clearS(ctx);
      await ctx.reply(`✅ ផ្ញើបាន: ${sent} | ❌ ផ្ញើមិនបាន: ${failed}`, KB.adminMain());
      return;
    }

    // ── Clone bot token ──────────────────────────────────────────────────────
    if (s.state === "clone_bot_token") {
      const newToken = text.trim();
      // Check if already exists first
      const existing = await getCloneBotByToken(newToken);
      if (existing) {
        await ctx.reply("❌ Bot Token នេះបន្ថែមរួចហើយ", KB.adminMain());
        clearS(ctx);
        return;
      }
      const count = await getCloneBotCount();
      if (count >= MAX_CLONE_BOTS) {
        clearS(ctx);
        await ctx.reply(`❌ ដល់ Limit ${MAX_CLONE_BOTS} Bot ហើយ`, KB.adminMain());
        return;
      }
      // Validate token by calling getMe (no launch, no stop needed)
      let info: { username?: string; id: number } | null = null;
      try {
        const tmpBot = new Telegraf(newToken);
        info = await tmpBot.telegram.getMe();
      } catch (_) {
        await ctx.reply("❌ Token មិនត្រឹមត្រូវ! សូមពិនិត្យ Token ពី @BotFather ម្តងទៀត");
        return;
      }
      const password = randomCode(10);
      const cb = await createCloneBot(newToken, telegramId, password, info.username);
      clearS(ctx);
      await ctx.replyWithHTML(
        `✅ Bot ក្លូនបន្ថែមបាន!\n\n🤖 @${info.username || "bot"}\n🆔 ID: <code>${cb.id}</code>\n🔐 Password Admin: <code>${password}</code>\n\n⚠️ រក្សាទុក Password នេះ! ប្រើវាដើម្បី Login Admin ក្នុង Bot ក្លូន`,
        KB.adminMain(),
      );
      process.emit("clone_bot_added" as any, cb);
      return;
    }

    // ── Clone check password ─────────────────────────────────────────────────
    if (s.state === "clone_check_password") {
      const id = parseInt(text.trim());
      clearS(ctx);
      if (isNaN(id)) { await ctx.reply("❌ ID មិនត្រឹមត្រូវ", KB.adminMain()); return; }
      const cb = await getCloneBotById(id);
      if (!cb) { await ctx.reply("❌ រកមិនឃើញ Clone Bot", KB.adminMain()); return; }
      await ctx.replyWithHTML(
        `🔐 <b>Clone Bot #${cb.id}</b>\n🤖 @${cb.botUsername || "unknown"}\n🔑 Password: <code>${cb.password}</code>`,
        KB.adminMain(),
      );
      return;
    }

    // ── Clone delete ─────────────────────────────────────────────────────────
    if (s.state === "clone_delete") {
      const id = parseInt(text.trim());
      clearS(ctx);
      if (isNaN(id)) { await ctx.reply("❌ ID មិនត្រឹមត្រូវ", KB.adminMain()); return; }
      const cb = await getCloneBotById(id);
      if (!cb) { await ctx.reply("❌ រកមិនឃើញ Clone Bot", KB.adminMain()); return; }
      await deactivateCloneBot(id);
      process.emit("clone_bot_removed" as any, id);
      await ctx.reply(`✅ Bot ក្លូន @${cb.botUsername || id} លុបរួចហើយ!`, KB.adminMain());
      return;
    }

    // ── Create promo code ────────────────────────────────────────────────────
    if (s.state === "create_promo_code") {
      setS(ctx, "create_promo_max_uses", { code: text.trim().toUpperCase() });
      await ctx.reply(`🎟️ កូដ: <code>${text.trim().toUpperCase()}</code>\n\nចំនួន User ដែលអាចប្រើ (ដូចជា 100):`, { parse_mode: "HTML", ...KB.cancel() });
      return;
    }

    if (s.state === "create_promo_max_uses") {
      const maxUses = parseInt(text);
      if (isNaN(maxUses) || maxUses <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      setS(ctx, "create_promo_amount", { ...s.data, maxUses });
      await ctx.reply("💰 ចំនួនលុយ User ម្នាក់ទទួលបាន (ដូចជា 0.5):", KB.cancel());
      return;
    }

    if (s.state === "create_promo_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      await createPromoCode(cloneBotId, s.data.code as string, amount, s.data.maxUses as number);
      clearS(ctx);
      await ctx.replyWithHTML(
        `✅ បង្កើតកូដ <code>${s.data.code}</code> រួចហើយ!\n💵 $${fmt(amount)} × ${s.data.maxUses} ដង`,
        KB.adminMain(),
      );
      return;
    }

    // ── Add channel link ─────────────────────────────────────────────────────
    if (s.state === "add_channel_link") {
      const link = text.trim();
      const usernameMatch = link.match(/t\.me\/([a-zA-Z0-9_]+)/);
      const username = usernameMatch ? usernameMatch[1] : null;
      setS(ctx, "add_channel_chatid", { channelLink: link, channelUsername: username });
      await ctx.replyWithHTML(
        `🔗 Link: ${link}\n\n📋 <b>ដាក់ Chat ID</b> ដើម្បី Verify Member:\n\n<i>របៀបបានChat ID:\n1. Add Bot ចូល Channel/Group\n2. Forward message ពី Group ទៅ @userinfobot\n3. Copy chat_id (ចាប់ផ្តើមដោយ -100...)\n\nឬដាក់ @username (public channels)\nឬដាក់ '-' ដើម្បីរំលង (មិន Verify)</i>`,
        KB.cancel(),
      );
      return;
    }

    if (s.state === "add_channel_chatid") {
      const input = text.trim();
      let chatId: string | null = null;
      let username = s.data.channelUsername as string | null;
      if (input !== "-") {
        chatId = input.startsWith("@") ? input : (input.startsWith("-") ? input : `@${input}`);
        if (input.startsWith("-100") || /^-\d+$/.test(input)) {
          chatId = input; // numeric chat ID
          username = null;
        }
      }
      setS(ctx, "add_channel_amount", { ...s.data, channelChatId: chatId, channelUsername: username ?? s.data.channelUsername });
      await ctx.reply("💰 ចំនួនលុយ User ទទួលបានពេលចូល:", KB.cancel());
      return;
    }

    if (s.state === "add_channel_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await ctx.reply("❌ ចំនួនមិនត្រឹមត្រូវ"); return; }
      await addChannelReward(
        cloneBotId,
        s.data.channelLink as string,
        s.data.channelUsername as string | null,
        s.data.channelChatId as string | null,
        amount,
        s.data.channelLink as string,
      );
      clearS(ctx);
      const verifyMode = s.data.channelChatId ? `✅ Verify: ${s.data.channelChatId}` : "⚠️ គ្មាន Verify";
      await ctx.reply(`✅ Channel/Group បន្ថែមរួចហើយ!\n💰 $${fmt(amount)} ពេលចូល\n${verifyMode}`, KB.adminMain());
      return;
    }

    // ── 2FA add key ───────────────────────────────────────────────────────────
    if (s.state === "2fa_add_name") {
      setS(ctx, "2fa_add_secret", { name: text.trim() });
      await ctx.reply(`🔐 ឈ្មោះ: <b>${text.trim()}</b>\n\nដាក់ Secret Key (Base32):\n<i>ទទួលបានពី QR Code ឬ "Enter key manually" ក្នុង Authenticator App</i>`, { parse_mode: "HTML", ...KB.cancel() });
      return;
    }

    if (s.state === "2fa_add_secret") {
      const secret = text.trim().replace(/\s/g, "").toUpperCase();
      // Validate the secret
      try {
        generateTOTP(secret); // will throw if invalid
        await add2faKey(cloneBotId, userId, s.data.name as string, secret);
        clearS(ctx);
        const token2fa = generateTOTP(secret);
        const remaining = totpTimeRemaining();
        await ctx.replyWithHTML(
          `✅ បន្ថែម 2FA Key បានជោគជ័យ!\n\n🔑 <b>${s.data.name}</b>\nកូដដំបូង: <code>${token2fa}</code>\n⏱️ ${remaining}s`,
          KB.userMain(),
        );
      } catch (_) {
        await ctx.reply("❌ Secret Key មិនត្រឹមត្រូវ! Base32 Secret ត្រូវតែជាអក្សរ A-Z 2-7\n\nសូមដាក់ Secret Key ម្តងទៀត:");
      }
      return;
    }
  }

  // ─── Document / Video / Photo handlers for stock input ───────────────────

  bot.on(message("document"), async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    await ensureBotUser(ctx, user.id);
    const s = ses(ctx);
    if (!s.isAdmin || s.state !== "add_product_stock_item") return;
    const fileId = ctx.message.document.file_id;
    const caption = ctx.message.caption || "";
    const content = JSON.stringify({ t: "doc", f: fileId, c: caption });
    await advanceStockItem(ctx, content, s);
  });

  bot.on(message("video"), async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    await ensureBotUser(ctx, user.id);
    const s = ses(ctx);
    if (!s.isAdmin || s.state !== "add_product_stock_item") return;
    const fileId = ctx.message.video.file_id;
    const caption = ctx.message.caption || "";
    const content = JSON.stringify({ t: "vid", f: fileId, c: caption });
    await advanceStockItem(ctx, content, s);
  });

  bot.on(message("photo"), async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    await ensureBotUser(ctx, user.id);
    const s = ses(ctx);
    if (!s.isAdmin || s.state !== "add_product_stock_item") return;
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const caption = ctx.message.caption || "";
    const content = JSON.stringify({ t: "photo", f: fileId, c: caption });
    await advanceStockItem(ctx, content, s);
  });

  bot.catch((err: unknown) => {
    logger.error({ err }, "Bot error");
  });

  return bot;
}
