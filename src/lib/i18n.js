// Simple bilingual (English / Hindi) string system with live toggle
import { useEffect, useState } from 'react';

const STRINGS = {
  en: {
    'nav.game': 'Game', 'nav.wallet': 'Wallet', 'nav.bets': 'My Bets', 'nav.chat': 'Chat', 'nav.support': 'Support', 'nav.profile': 'Profile',
    'game.period': 'Current Period', 'game.duration': 'Duration', 'game.left': 'left', 'game.closing': 'closing…', 'game.result': 'result…',
    'game.betting_closed': 'Betting closed — result coming…',
    'game.paused': 'Game paused by admin', 'game.maintenance': 'Under maintenance — back soon',
    'game.pick_number': 'Pick a Number', 'game.pick_color': 'Pick a Color', 'game.pick_size': 'Big or Small',
    'game.red_even': 'Red (even)', 'game.zero_rv': '0 = Red+Violet', 'game.green_odd': 'Green (odd)',
    'game.last50': 'Last 50 Results', 'game.top_winners': 'Top Winners', 'game.no_winner': 'No winners yet — first win could be yours!',
    'game.waiting': 'Waiting for result — your bet:', 'game.this_period': 'Your bet this period', 'game.total_staked': 'Total staked',
    'game.bet_on': 'Bet on', 'game.amount': 'Amount (₹)', 'game.potential': 'Potential win', 'game.available': 'Available',
    'game.place_bet': 'Place Bet', 'game.placing': 'Placing…', 'game.cancel': 'Cancel',
    'game.you_won': 'You WON', 'game.you_lost': 'You lost', 'game.tap_continue': 'tap anywhere to continue',
    'game.bets_count': 'bets', 'game.first_result': 'First result coming soon…',
    'game.max_per_period': 'max', 'game.per_period': 'bets/period', 'game.unlimited': 'unlimited bets',
    'wallet.balance': 'Available Balance', 'wallet.deposit': 'Deposit', 'wallet.withdraw': 'Withdraw', 'wallet.history': 'History',
    'wallet.amount': 'Amount', 'wallet.upi_ref': 'UPI Transaction Ref (UTR)', 'wallet.screenshot': 'Payment Screenshot (recommended)',
    'wallet.submit': 'I Have Paid — Submit for Approval', 'wallet.submitting': 'Submitting…',
    'wallet.request': 'Request Withdrawal', 'wallet.your_upi': 'Your UPI ID', 'wallet.full': 'Full',
    'wallet.deposit_note': 'Send to UPI ID:', 'wallet.upi_id': 'UPI ID (QR unlocks on valid amount)',
    'wallet.scan': 'Scan with', 'wallet.locked_note': 'Balance locks instantly and is released on approval.',
    'wallet.readonly_feed': 'Read-only feed — your messages reach admin via Support tab',
    'wallet.min_dep': 'Minimum deposit', 'wallet.deposits': 'Deposits', 'wallet.withdrawals': 'Withdrawals',
    'auth.login': 'Login', 'auth.signup': 'Sign Up', 'auth.email': 'Email', 'auth.password': 'Password',
    'auth.ref_code': 'Referral Code (optional)', 'auth.login_btn': 'Login', 'auth.create_btn': 'Create Account',
    'auth.send_reset': 'Send Reset Link', 'auth.forgot': 'Forgot password?', 'auth.reset_it': 'Reset it', 'auth.back_login': 'Back to login',
    'auth.welcome_back': 'Welcome Back', 'auth.tagline': 'Color Prediction — Play, Win, Climb Ranks',
    'chat.announcements': 'Admin Announcements', 'chat.announcements_sub': 'This feed is for admin broadcasts only (read-only). Use the Support tab to talk to admin.',
    'chat.feed': 'Community Feed', 'chat.live': 'live', 'chat.no_ann': 'No announcements yet',
    'support.title': 'Support Chat', 'support.private': 'Private conversation — only you and admin can see this',
    'support.new_ticket': 'New Ticket', 'support.subject': 'Subject', 'support.category': 'Category',
    'support.send': 'Send', 'support.send_reply': 'Type a message…', 'support.no_tickets': 'No tickets yet — raise one below',
    'support.categories': 'Category', 'support.ticket_opened': 'Ticket opened — admin will reply soon',
    'support.reported': 'Bet details attached',
    'profile.title': 'Profile', 'profile.referral': 'My Referral', 'profile.your_code': 'YOUR CODE',
    'profile.copy_code': 'Copy Code', 'profile.share_link': 'Share Referral Link', 'profile.team': 'Team',
    'profile.next_rank': 'Next', 'profile.rank_note': 'Ranks grow with your team size — no cash rewards, pure prestige.',
    'profile.top_referrers': 'TOP REFERRERS', 'profile.deposits': 'Total Deposits', 'profile.withdrawn': 'Total Withdrawn',
    'profile.total_bets': 'Total Bets', 'profile.total_won': 'Total Won', 'profile.member_since': 'Member since',
    'profile.contact': 'Contact Details', 'profile.phone': 'Phone', 'profile.upi': 'UPI ID (for withdrawals)',
    'profile.save': 'Save Details', 'profile.preferences': 'Preferences', 'profile.theme': 'Theme',
    'profile.theme_sub': 'Light or dark interface', 'profile.sound': 'Sound FX', 'profile.sound_sub': 'Clicks, wins, notifications',
    'profile.lang': 'Language', 'profile.lang_sub': 'English / Hindi',
    'profile.change_pw': 'Change Password', 'profile.change_pw_sub': 'Min 6 characters', 'profile.update_pw': 'Update Password',
    'profile.responsible': 'Responsible Play', 'profile.self_excl': 'Self-Exclusion (Take a break)',
    'profile.self_excl_sub': 'Betting/deposit/withdraw stops instantly — you can turn OFF anytime',
    'profile.del_request': 'Request Account Deletion', 'profile.del_sub': 'Admin will review. Balance stays safe till review.',
    'profile.about': 'About', 'profile.logout': 'Logout',
    'bets.total': 'Total Bets', 'bets.wins': 'Wins', 'bets.net': 'Net P/L', 'bets.pending': 'Pending',
    'bets.all': 'All', 'bets.wins_tab': 'Wins', 'bets.losses': 'Losses', 'bets.receipt': 'Receipt',
    'bets.report': 'Report', 'bets.no_bets': 'No bets here yet — place your first bet!',
    'bets.receipt_title': 'Bet Receipt', 'bets.period': 'Period', 'bets.type': 'Type', 'bets.selection': 'Selection',
    'bets.amount': 'Amount', 'bets.result': 'Result', 'bets.win_amount': 'Win Amount', 'bets.time': 'Placed At',
    'common.save': 'Save', 'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.search': 'Search…',
    'install.prompt': 'Install App', 'install.banner': 'Install JIO CLUB for the full app experience',
    'notifs.title': 'Notifications', 'notifs.mark_all': 'Mark all as read', 'notifs.empty': 'No notifications yet',
    'operator.title': 'Operator Account', 'operator.sub': 'This is an admin/operator account — it cannot play as a player. Use the Admin Panel instead.',
    'operator.open_admin': 'Open Admin Panel',
  },
  hi: {
    'nav.game': 'गेम', 'nav.wallet': 'वॉलेट', 'nav.bets': 'मेरे बेट्स', 'nav.chat': 'चैट', 'nav.support': 'सपोर्ट', 'nav.profile': 'प्रोफ़ाइल',
    'game.period': 'अभी का पीरियड', 'game.duration': 'अवधि', 'game.left': 'बाकी', 'game.closing': 'बंद हो रहा…', 'game.result': 'रिज़ल्ट…',
    'game.betting_closed': 'बेटिंग बंद — रिज़ल्ट आ रहा है…',
    'game.paused': 'एडमिन ने गेम रोक दिया है', 'game.maintenance': 'मेंटेनेंस — जल्द वापस',
    'game.pick_number': 'नंबर चुनें', 'game.pick_color': 'रंग चुनें', 'game.pick_size': 'बिग या स्मॉल',
    'game.red_even': 'रेड (even)', 'game.zero_rv': '0 = Red+Violet', 'game.green_odd': 'ग्रीन (odd)',
    'game.last50': 'पिछले 50 रिज़ल्ट', 'game.top_winners': 'टॉप विनर्स', 'game.no_winner': 'अभी कोई विनर नहीं — पहला जीत आपकी हो सकता है!',
    'game.waiting': 'रिज़ल्ट का इंतज़ार — आपका बेट:', 'game.this_period': 'इस पीरियड का आपका बेट', 'game.total_staked': 'कुल लगाया',
    'game.bet_on': 'बेट करें', 'game.amount': 'राशि (₹)', 'game.potential': 'संभावित जीत', 'game.available': 'उपलब्ध',
    'game.place_bet': 'बेट लगाएं', 'game.placing': 'लगा रहे हैं…', 'game.cancel': 'रद्द करें',
    'game.you_won': 'आप जीते', 'game.you_lost': 'आप हारे', 'game.tap_continue': 'जारी रखने के लिए कहीं टैप करें',
    'game.bets_count': 'बेट्स', 'game.first_result': 'पहला रिज़ल्ट आ रहा है…',
    'game.max_per_period': 'अधिकतम', 'game.per_period': 'बेट्स/पीरियड', 'game.unlimited': 'असीमित बेट्स',
    'wallet.balance': 'उपलब्ध बैलेंस', 'wallet.deposit': 'डिपॉज़िट', 'wallet.withdraw': 'व्हाइटड्रॉ', 'wallet.history': 'हिस्ट्री',
    'wallet.amount': 'राशि', 'wallet.upi_ref': 'UPI ट्रांज़ैक्शन रीफरेंस (UTR)', 'wallet.screenshot': 'पेमेंट स्क्रीनशॉट (सुझाव)',
    'wallet.submit': 'पेमेंट हो गया — अनुमोदन के लिए भेजें', 'wallet.submitting': 'भेज रहे हैं…',
    'wallet.request': 'व्हाइटड्रॉ रिक्वेस्ट', 'wallet.your_upi': 'आपका UPI ID', 'wallet.full': 'पूरा',
    'wallet.deposit_note': 'इस UPI ID पे भेजें:', 'wallet.upi_id': 'UPI ID (सही राशि पे QR खुलेगा)',
    'wallet.scan': 'स्कैन करें', 'wallet.locked_note': 'बैलेंस तुरंत lock होता है और approval पे मिलता है।',
    'wallet.readonly_feed': 'सिर्फ पढ़ने के लिए — आपकी मैसेज सपोर्ट टैब से एडमिन तक जाती है',
    'wallet.min_dep': 'न्यूनतम डिपॉज़िट', 'wallet.deposits': 'डिपॉज़िट', 'wallet.withdrawals': 'व्हाइटड्रॉ',
    'auth.login': 'लॉगिन', 'auth.signup': 'साइन अप', 'auth.email': 'ईमेल', 'auth.password': 'पासवर्ड',
    'auth.ref_code': 'रेफरल कोड (वैकल्पिक)', 'auth.login_btn': 'लॉगिन', 'auth.create_btn': 'अकाउंट बनाएं',
    'auth.send_reset': 'रीसेट लिंक भेजें', 'auth.forgot': 'पासवर्ड भूले?', 'auth.reset_it': 'रीसेट करें', 'auth.back_login': 'लॉगिन पर वापस',
    'auth.welcome_back': 'वापसी पर स्वागत', 'auth.tagline': 'कलर प्रेडिकशन — खेलें, जीतें, रैंक बढ़ाएं',
    'chat.announcements': 'एडमिन घोषणाएं', 'chat.announcements_sub': 'यह फीड सिर्फ एडमिन ब्रॉडकास्ट के लिए है। एडमिन से बात के लिए सपोर्ट टैब इस्तेमाल करें।',
    'chat.feed': 'कम्युनिटी फीड', 'chat.live': 'लाइव', 'chat.no_ann': 'अभी कोई घोषणा नहीं',
    'support.title': 'सपोर्ट चैट', 'support.private': 'प्राइवेट बातचीत — सिर्फ आप और एडमइन यह देख सकते हैं',
    'support.new_ticket': 'नया टिकट', 'support.subject': 'विषय', 'support.category': 'श्रेणी',
    'support.send': 'भेजें', 'support.send_reply': 'मैसेज लिखें…', 'support.no_tickets': 'कोई टिकट नहीं — नीचे बनाएं',
    'support.categories': 'श्रेणी', 'support.ticket_opened': 'टिकट खुल गया — एडमिन जल्द जवाब देगा',
    'support.reported': 'बेट की जानकारी जुड़ गई',
    'profile.title': 'प्रोफ़ाइल', 'profile.referral': 'मेरा रेफरल', 'profile.your_code': 'आपका कोड',
    'profile.copy_code': 'कोड कॉपी', 'profile.share_link': 'रेफरल लिंक शेयर', 'profile.team': 'टीम',
    'profile.next_rank': 'अगला', 'profile.rank_note': 'रैंक टीम से बढ़ती है — कोई कैश रिवॉर्ड नहीं, सिर्फ पद।',
    'profile.top_referrers': 'टॉप रेफरर', 'profile.deposits': 'कुल डिपॉज़िट', 'profile.withdrawn': 'कुल व्हाइटड्रॉ',
    'profile.total_bets': 'कुल बेट्स', 'profile.total_won': 'कुल जीत', 'profile.member_since': 'सदस्य',
    'profile.contact': 'संपर्क विवरण', 'profile.phone': 'फ़ोन', 'profile.upi': 'UPI ID (व्हाइटड्रॉ के लिए)',
    'profile.save': 'सेव करें', 'profile.preferences': 'प्रेफरेंस', 'profile.theme': 'थीम',
    'profile.theme_sub': 'लाइट या डार्क', 'profile.sound': 'साउंड', 'profile.sound_sub': 'क्लिक, जीत, सूचनाएं',
    'profile.lang': 'भाषा', 'profile.lang_sub': 'English / हिंदी',
    'profile.change_pw': 'पासवर्ड बदलें', 'profile.change_pw_sub': 'न्यूनतम 6 अक्षर', 'profile.update_pw': 'पासवर्ड अपडेट',
    'profile.responsible': 'जिम्मेदार खेल', 'profile.self_excl': 'सेल्फ-एक्सक्लूज़न (ब्रेक लें)',
    'profile.self_excl_sub': 'बेटिंग/डिपॉज़िट/व्हाइटड्रॉ तुरंत बंद — कभी भी OFF कर सकते हैं',
    'profile.del_request': 'अकाउंट डिलीशन रिक्वेस्ट', 'profile.del_sub': 'एडमिन जांचेगा। बैलेंस सुरक्षित रहेगा।',
    'profile.about': 'बारे में', 'profile.logout': 'लॉगआउट',
    'bets.total': 'कुल बेट्स', 'bets.wins': 'जीत', 'bets.net': 'नेट P/L', 'bets.pending': 'पेंडिंग',
    'bets.all': 'सभी', 'bets.wins_tab': 'जीत', 'bets.losses': 'हार', 'bets.receipt': 'रसीद',
    'bets.report': 'शिकायत', 'bets.no_bets': 'कोई बेट नहीं — पहला बेट लगाएं!',
    'bets.receipt_title': 'बेट रसीद', 'bets.period': 'पीरियड', 'bets.type': 'टाइप', 'bets.selection': 'चयन',
    'bets.amount': 'राशि', 'bets.result': 'नतीजा', 'bets.win_amount': 'जीत राशि', 'bets.time': 'जारी',
    'common.save': 'सेव', 'common.cancel': 'रद्द', 'common.confirm': 'पक्का', 'common.search': 'खोजें…',
    'install.prompt': 'ऐप इंस्टॉल', 'install.banner': 'पूरा ऐप अनुभव के लिए JIO CLUB इंस्टॉल करें',
    'notifs.title': 'सूचनाएं', 'notifs.mark_all': 'सभी पढ़ी हुई करें', 'notifs.empty': 'कोई सूचना नहीं',
    'operator.title': 'ओपरेटर अकाउंट', 'operator.sub': 'यह एडमिन/ओपरेटर अकाउंट है — यह प्लेयर के रूप में नहीं खेल सकता। एडमिन पैनल इस्तेमाल करें।',
    'operator.open_admin': 'एडमिन पैनल खोलें',
  }
};

let lang = 'en';
try { lang = localStorage.getItem('jc-lang') || 'en'; } catch (e) { /* ignore */ }

export function getLang() { return lang; }
export function setLang(l) {
  lang = (l === 'hi') ? 'hi' : 'en';
  try { localStorage.setItem('jc-lang', lang); } catch (e) { /* ignore */ }
  window.dispatchEvent(new CustomEvent('jc:lang', { detail: lang }));
}
export function toggleLang() { setLang(lang === 'en' ? 'hi' : 'en'); }
export function t(key) { return STRINGS[lang]?.[key] || STRINGS.en[key] || key; }

export function useT() {
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((x) => x + 1);
    window.addEventListener('jc:lang', on);
    return () => window.removeEventListener('jc:lang', on);
  }, []);
  return t;
}
