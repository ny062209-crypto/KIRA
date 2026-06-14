import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  users,
  botUsers,
  products,
  productStocks,
  orders,
  transactions,
  promoCodes,
  promoCodeUses,
  channelRewards,
  channelRewardClaims,
  cloneBots,
  botSettings,
  user2faKeys,
  type User,
  type BotUser,
  type Product,
  type CloneBot,
} from "@workspace/db";

// ─── User helpers ────────────────────────────────────────────────────────────

export async function getOrCreateUser(
  telegramId: string,
  firstName?: string,
  username?: string,
  lastName?: string,
): Promise<User> {
  const existing = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ telegramId, firstName, username, lastName })
    .returning();
  return created;
}

export async function getUserByTelegramId(telegramId: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });
}

export async function getUserById(id: number): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function getAllUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(desc(users.createdAt));
}

// ─── BotUser helpers ──────────────────────────────────────────────────────────

function botCondition(cloneBotId: number | null) {
  return cloneBotId === null
    ? isNull(botUsers.cloneBotId)
    : eq(botUsers.cloneBotId, cloneBotId);
}

export async function getOrCreateBotUser(
  cloneBotId: number | null,
  userId: number,
  referrerId?: number,
): Promise<BotUser> {
  const existing = await db.query.botUsers.findFirst({
    where: and(botCondition(cloneBotId), eq(botUsers.userId, userId)),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(botUsers)
    .values({
      cloneBotId: cloneBotId ?? null,
      userId,
      balance: "0",
      referrerId: referrerId ?? null,
    })
    .returning();
  return created;
}

export async function getBalance(
  cloneBotId: number | null,
  userId: number,
): Promise<number> {
  const bu = await db.query.botUsers.findFirst({
    where: and(botCondition(cloneBotId), eq(botUsers.userId, userId)),
  });
  return bu ? parseFloat(bu.balance) : 0;
}

export async function addBalance(
  cloneBotId: number | null,
  userId: number,
  amount: number,
  type: string,
  description?: string,
): Promise<void> {
  await db
    .update(botUsers)
    .set({ balance: sql`balance + ${amount.toFixed(4)}` })
    .where(and(botCondition(cloneBotId), eq(botUsers.userId, userId)));
  await db.insert(transactions).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    amount: amount.toFixed(4),
    type,
    description,
  });
}

export async function deductBalance(
  cloneBotId: number | null,
  userId: number,
  amount: number,
  type: string,
  description?: string,
): Promise<boolean> {
  const bal = await getBalance(cloneBotId, userId);
  if (bal < amount) return false;
  await db
    .update(botUsers)
    .set({ balance: sql`balance - ${amount.toFixed(4)}` })
    .where(and(botCondition(cloneBotId), eq(botUsers.userId, userId)));
  await db.insert(transactions).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    amount: (-amount).toFixed(4),
    type,
    description,
  });
  return true;
}

export async function setBalance(
  cloneBotId: number | null,
  userId: number,
  amount: number,
): Promise<void> {
  await db
    .update(botUsers)
    .set({ balance: amount.toFixed(4) })
    .where(and(botCondition(cloneBotId), eq(botUsers.userId, userId)));
  await db.insert(transactions).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    amount: amount.toFixed(4),
    type: "admin_set",
    description: "Admin set balance",
  });
}

export async function drainBalance(
  cloneBotId: number | null,
  userId: number,
): Promise<number> {
  const bal = await getBalance(cloneBotId, userId);
  if (bal <= 0) return 0;
  await db
    .update(botUsers)
    .set({ balance: "0" })
    .where(and(botCondition(cloneBotId), eq(botUsers.userId, userId)));
  await db.insert(transactions).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    amount: (-bal).toFixed(4),
    type: "admin_drain",
    description: "Admin drained all balance",
  });
  return bal;
}

export async function getAllBotUsers(cloneBotId: number | null) {
  return db.query.botUsers.findMany({
    where: botCondition(cloneBotId),
    with: { user: true } as any,
  });
}

// ─── Product helpers ──────────────────────────────────────────────────────────

export async function getProducts(cloneBotId: number | null): Promise<Product[]> {
  return db.query.products.findMany({
    where: and(
      cloneBotId === null ? isNull(products.cloneBotId) : eq(products.cloneBotId, cloneBotId),
      eq(products.active, true),
    ),
    orderBy: desc(products.createdAt),
  });
}

export async function getProductById(id: number): Promise<Product | undefined> {
  return db.query.products.findFirst({ where: eq(products.id, id) });
}

export async function createProduct(
  cloneBotId: number | null,
  name: string,
  description: string,
  price: number,
): Promise<Product> {
  const [p] = await db
    .insert(products)
    .values({
      cloneBotId: cloneBotId ?? null,
      name,
      description,
      price: price.toFixed(4),
      totalStock: 0,
      availableStock: 0,
    })
    .returning();
  return p;
}

export async function addProductStock(productId: number, content: string): Promise<void> {
  await db.insert(productStocks).values({ productId, content });
  await db
    .update(products)
    .set({
      totalStock: sql`total_stock + 1`,
      availableStock: sql`available_stock + 1`,
    })
    .where(eq(products.id, productId));
}

export async function deleteProduct(id: number): Promise<void> {
  await db.update(products).set({ active: false }).where(eq(products.id, id));
}

export async function updateProduct(
  id: number,
  fields: { name?: string; description?: string; price?: number },
): Promise<void> {
  const patch: { name?: string; description?: string; price?: string } = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.price !== undefined) patch.price = fields.price.toFixed(4);
  if (Object.keys(patch).length === 0) return;
  await db.update(products).set(patch).where(eq(products.id, id));
}

export async function buyProduct(
  cloneBotId: number | null,
  userId: number,
  productId: number,
): Promise<{ success: boolean; content?: string; message: string }> {
  const product = await getProductById(productId);
  if (!product) return { success: false, message: "រកមិនឃើញផលិតផល" };
  if (product.availableStock <= 0) return { success: false, message: "ស្តុកអស់ហើយ" };

  const price = parseFloat(product.price);
  const bal = await getBalance(cloneBotId, userId);
  if (bal < price) {
    return { success: false, message: `លុយមិនគ្រប់គ្រាន់! អ្នកមាន $${bal.toFixed(4)} ត្រូវការ $${price.toFixed(4)}` };
  }

  const stock = await db.query.productStocks.findFirst({
    where: and(eq(productStocks.productId, productId), eq(productStocks.isUsed, false)),
    orderBy: productStocks.id,
  });
  if (!stock) return { success: false, message: "ស្តុកអស់ហើយ" };

  await db
    .update(productStocks)
    .set({ isUsed: true, buyerUserId: userId, soldAt: new Date() })
    .where(eq(productStocks.id, stock.id));

  await db
    .update(products)
    .set({ availableStock: sql`available_stock - 1` })
    .where(eq(products.id, productId));

  await deductBalance(cloneBotId, userId, price, "purchase", `ទិញ ${product.name}`);

  await db.insert(orders).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    productId,
    stockId: stock.id,
    productName: product.name,
    amount: price.toFixed(4),
  });

  return { success: true, content: stock.content, message: "ទិញបានជោគជ័យ" };
}

export async function getUserOrders(cloneBotId: number | null, userId: number) {
  return db.query.orders.findMany({
    where: and(
      cloneBotId === null ? isNull(orders.cloneBotId) : eq(orders.cloneBotId, cloneBotId),
      eq(orders.userId, userId),
    ),
    orderBy: desc(orders.createdAt),
    limit: 20,
  });
}

export async function getAllOrders(cloneBotId: number | null) {
  return db.query.orders.findMany({
    where: cloneBotId === null ? isNull(orders.cloneBotId) : eq(orders.cloneBotId, cloneBotId),
    orderBy: desc(orders.createdAt),
    limit: 50,
  });
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

export async function getSetting(
  cloneBotId: number | null,
  key: string,
): Promise<string | null> {
  const s = await db.query.botSettings.findFirst({
    where: and(
      cloneBotId === null ? isNull(botSettings.cloneBotId) : eq(botSettings.cloneBotId, cloneBotId),
      eq(botSettings.key, key),
    ),
  });
  return s?.value ?? null;
}

export async function setSetting(
  cloneBotId: number | null,
  key: string,
  value: string,
): Promise<void> {
  const existing = await db.query.botSettings.findFirst({
    where: and(
      cloneBotId === null ? isNull(botSettings.cloneBotId) : eq(botSettings.cloneBotId, cloneBotId),
      eq(botSettings.key, key),
    ),
  });
  if (existing) {
    await db.update(botSettings).set({ value }).where(eq(botSettings.id, existing.id));
  } else {
    await db.insert(botSettings).values({ cloneBotId: cloneBotId ?? null, key, value });
  }
}

// ─── Promo code helpers ───────────────────────────────────────────────────────

export async function createPromoCode(
  cloneBotId: number | null,
  code: string,
  amountPerUse: number,
  maxUses: number,
): Promise<void> {
  await db.insert(promoCodes).values({
    cloneBotId: cloneBotId ?? null,
    code: code.toUpperCase(),
    amountPerUse: amountPerUse.toFixed(4),
    maxUses,
  });
}

export async function redeemPromoCode(
  cloneBotId: number | null,
  userId: number,
  code: string,
): Promise<{ success: boolean; amount?: number; message: string }> {
  const pc = await db.query.promoCodes.findFirst({
    where: and(
      cloneBotId === null ? isNull(promoCodes.cloneBotId) : eq(promoCodes.cloneBotId, cloneBotId),
      eq(promoCodes.code, code.toUpperCase()),
      eq(promoCodes.active, true),
    ),
  });
  if (!pc) return { success: false, message: "កូដមិនត្រឹមត្រូវ ឬអស់ហើយ" };
  if (pc.usedCount >= pc.maxUses)
    return { success: false, message: "កូដនេះអស់ limit ហើយ" };

  const alreadyUsed = await db.query.promoCodeUses.findFirst({
    where: and(eq(promoCodeUses.codeId, pc.id), eq(promoCodeUses.userId, userId)),
  });
  if (alreadyUsed) return { success: false, message: "អ្នកដាក់កូដនេះរួចហើយ" };

  await db.insert(promoCodeUses).values({ codeId: pc.id, userId });
  await db
    .update(promoCodes)
    .set({ usedCount: sql`used_count + 1` })
    .where(eq(promoCodes.id, pc.id));

  const amount = parseFloat(pc.amountPerUse);
  await addBalance(cloneBotId, userId, amount, "promo_code", `ដាក់កូដ ${code.toUpperCase()}`);

  if (pc.usedCount + 1 >= pc.maxUses) {
    await db.update(promoCodes).set({ active: false }).where(eq(promoCodes.id, pc.id));
  }

  return { success: true, amount, message: "ដាក់កូដបានជោគជ័យ" };
}

export async function getPromoCodes(cloneBotId: number | null) {
  return db.query.promoCodes.findMany({
    where: cloneBotId === null ? isNull(promoCodes.cloneBotId) : eq(promoCodes.cloneBotId, cloneBotId),
    orderBy: desc(promoCodes.createdAt),
  });
}

// ─── Channel reward helpers ───────────────────────────────────────────────────

export async function addChannelReward(
  cloneBotId: number | null,
  channelLink: string,
  channelUsername: string | null,
  channelChatId: string | null,
  amount: number,
  description?: string,
): Promise<void> {
  await db.insert(channelRewards).values({
    cloneBotId: cloneBotId ?? null,
    channelLink,
    channelUsername,
    channelChatId,
    amount: amount.toFixed(4),
    description,
  });
}

// ─── Clone bot by token ───────────────────────────────────────────────────────

export async function getCloneBotByToken(token: string): Promise<CloneBot | undefined> {
  return db.query.cloneBots.findFirst({ where: eq(cloneBots.token, token) });
}

// ─── 2FA key helpers ──────────────────────────────────────────────────────────

export async function get2faKeys(cloneBotId: number | null, userId: number) {
  return db.query.user2faKeys.findMany({
    where: and(
      cloneBotId === null ? isNull(user2faKeys.cloneBotId) : eq(user2faKeys.cloneBotId, cloneBotId),
      eq(user2faKeys.userId, userId),
    ),
    orderBy: user2faKeys.name,
  });
}

export async function add2faKey(
  cloneBotId: number | null,
  userId: number,
  name: string,
  secret: string,
): Promise<void> {
  await db.insert(user2faKeys).values({
    cloneBotId: cloneBotId ?? null,
    userId,
    name,
    secret: secret.replace(/\s/g, "").toUpperCase(),
  });
}

export async function delete2faKey(id: number, userId: number): Promise<boolean> {
  const key = await db.query.user2faKeys.findFirst({
    where: and(eq(user2faKeys.id, id), eq(user2faKeys.userId, userId)),
  });
  if (!key) return false;
  await db.delete(user2faKeys).where(eq(user2faKeys.id, id));
  return true;
}

export async function getChannelRewards(cloneBotId: number | null) {
  return db.query.channelRewards.findMany({
    where: and(
      cloneBotId === null ? isNull(channelRewards.cloneBotId) : eq(channelRewards.cloneBotId, cloneBotId),
      eq(channelRewards.active, true),
    ),
  });
}

export async function claimChannelReward(
  cloneBotId: number | null,
  userId: number,
  rewardId: number,
): Promise<{ success: boolean; amount?: number; message: string }> {
  const reward = await db.query.channelRewards.findFirst({
    where: and(eq(channelRewards.id, rewardId), eq(channelRewards.active, true)),
  });
  if (!reward) return { success: false, message: "រកមិនឃើញ reward" };

  const already = await db.query.channelRewardClaims.findFirst({
    where: and(
      eq(channelRewardClaims.rewardId, rewardId),
      eq(channelRewardClaims.userId, userId),
    ),
  });
  if (already) return { success: false, message: "អ្នកទទួលបានលុយនេះរួចហើយ" };

  await db.insert(channelRewardClaims).values({ rewardId, userId });
  const amount = parseFloat(reward.amount);
  await addBalance(cloneBotId, userId, amount, "channel_reward", `ចូល Channel: ${reward.channelLink}`);

  return { success: true, amount, message: "ទទួលបានលុយ" };
}

// ─── Clone bot helpers ────────────────────────────────────────────────────────

export async function createCloneBot(
  token: string,
  ownerTelegramId: string,
  password: string,
  botUsername?: string,
): Promise<CloneBot> {
  const [cb] = await db
    .insert(cloneBots)
    .values({ token, ownerTelegramId, password, botUsername })
    .returning();
  return cb;
}

export async function getCloneBots(): Promise<CloneBot[]> {
  return db.query.cloneBots.findMany({ where: eq(cloneBots.active, true) });
}

export async function getAllCloneBots(): Promise<CloneBot[]> {
  return db.query.cloneBots.findMany({ orderBy: desc(cloneBots.createdAt) });
}

export async function getCloneBotById(id: number): Promise<CloneBot | undefined> {
  return db.query.cloneBots.findFirst({ where: eq(cloneBots.id, id) });
}

export async function deactivateCloneBot(id: number): Promise<void> {
  await db.update(cloneBots).set({ active: false }).where(eq(cloneBots.id, id));
}

export async function getCloneBotCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(cloneBots)
    .where(eq(cloneBots.active, true));
  return Number(result[0]?.count ?? 0);
}
