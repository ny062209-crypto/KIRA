import { Markup } from "telegraf";

export const userMain = () =>
  Markup.keyboard([
    ["🛍️ ផលិតផល", "💰 កាបូបលុយ"],
    ["🆔 ID របស់ខ្ញុំ", "📋 ការបញ្ជាទិញ"],
    ["👥 ណែនាំ", "🔗 ចូល Channel/Group"],
    ["🎟️ ដាក់កូដ", "🔐 2FA Codes"],
  ]).resize();

export const adminMain = () =>
  Markup.keyboard([
    ["➕ បន្ថែមផលិតផល", "📋 ផលិតផល"],
    ["📊 ការបញ្ជាទិញ", "👥 Users"],
    ["💰 ដាក់លុយ", "💸 ដកលុយ"],
    ["🔧 កែលុយ User", "🪙 ដកទាំងអស់"],
    ["📢 Broadcast", "🆔 ពិនិត្យ User"],
    ["✉️ សារស្វាគមន៍", "🛒 សារក្រោយទិញ"],
    ["📤 ផ្ញើសារទៅ Users", "🔑 Clone Code"],
    ["👁️ ពិនិត្យ Bot ក្លូន", "🔐 ឆែក Password Bot ក្លូន"],
    ["🗑️ លុប Bot ក្លូន", "🎟️ បង្កើតកូដ"],
    ["🔗 បន្ថែម Channel", "🔙 ចេញ Admin"],
  ]).resize();

export const back = () => Markup.keyboard([["🔙 ត្រឡប់"]]).resize();
export const cancel = () => Markup.keyboard([["❌ បោះបង់"]]).resize();
export const confirmCancel = () =>
  Markup.keyboard([["✅ បញ្ជាក់", "❌ បោះបង់"]]).resize();
