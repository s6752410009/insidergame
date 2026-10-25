/* Explain the server's legal moves; never invent or authorize a move in the client. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlaveGuide = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const names = ['', 'เดี่ยว', 'คู่', 'ตอง', 'โฟร์'];
  function setName(cards) {
    if (!cards?.length) return '';
    return cards.length === 1 ? cards[0].label : names[cards.length] + ' ' + cards[0].rank;
  }
  function requirement(state) {
    if (state.openingRequired) return 'ตาแรกเลือก 3♣ ก่อน · เพิ่มหน้า 3 เป็นชุดได้';
    if (!state.top) return 'เปิดกองใหม่ · เลือกเดี่ยว คู่ ตอง หรือโฟร์หน้าเดียวกัน';
    const cards = state.top.cards, count = cards.length;
    return 'ลง' + names[count] + 'ใหญ่กว่า ' + setName(cards) + (count === 1 ? ' · หรือตองตัด' : count === 2 ? ' · หรือโฟร์ตัด' : '');
  }
  function analyze(state, selection) {
    const ids = [...selection], hand = state.self?.hand || [], count = state.self?.exchangeCount || 0;
    const cards = ids.map(id => hand.find(c => c.id === id)).filter(Boolean);
    if (count) {
      const legal = ids.length === count && cards.length === count;
      return {
        legal,
        candidates: legal ? ids : hand.map(c => c.id),
        message: legal ? 'เลือกครบ ' + count + ' ใบแล้ว · กดยืนยันคืนไพ่' : ids.length ? 'เลือกแล้ว ' + ids.length + '/' + count + ' · แตะไพ่ ↑ อีก ' + (count - ids.length) + ' ใบ' : 'แตะไพ่ ↑ เลือกจากมือเดิมคืน ' + count + ' ใบ',
        label: legal ? 'ยืนยันคืน ' + count + ' ใบ' : 'เลือกคืนอีก ' + (count - ids.length) + ' ใบ',
        invalid: false
      };
    }
    const moves = state.legalMoves || [];
    const matches = moves.filter(move => ids.every(id => move.includes(id)));
    const legal = ids.length > 0 && matches.some(move => move.length === ids.length);
    let message = state.openingRequired ? 'แตะไพ่ ↑ 3♣ เพื่อเปิดกอง · เพิ่มหน้า 3 เป็นชุดได้' : !state.top ? 'แตะไพ่ ↑ เพื่อเริ่มชุด · เดี่ยว คู่ ตอง หรือโฟร์หน้าเดียวกัน' : 'แตะไพ่ ↑ · ' + requirement(state), invalid = false;
    if (state.canPlay && !moves.length) message = 'ไม่มีชุดที่ชนะกองนี้ · กดผ่านเพื่อรอกองใหม่';
    else if (ids.length) {
      if (cards.length !== ids.length) { message = 'ไพ่ในมือเปลี่ยนแล้ว · เลือกชุดใหม่'; invalid = true; }
      else if (cards.some(c => c.rank !== cards[0].rank)) { message = 'ชุดนี้มีหลายหน้า · แตะยกเลิกใบที่ต่างหน้า'; invalid = true; }
      else if (state.openingRequired && !ids.includes(0)) { message = matches.length ? 'ตาแรกต้องมี 3♣ · แตะไพ่ ↑ 3♣ เพิ่ม' : 'ตาแรกต้องมี 3♣ · ยกเลิกชุดนี้ แล้วเลือก 3♣ ก่อน'; invalid = !matches.length; }
      else if (legal) message = 'ลง' + setName(cards) + ' ได้ · กดปุ่มลงไพ่';
      else if (matches.length) {
        const size = Math.min(...matches.map(move => move.length));
        message = 'แตะไพ่ ↑ เลือกเพิ่มอีก ' + (size - ids.length) + ' ใบให้ครบ' + names[size] + 'หน้า ' + cards[0].rank;
      } else {
        invalid = true;
        const topCount = state.top?.cards.length;
        message = topCount === ids.length ? 'ชุดนี้ยังไม่ใหญ่กว่ากองกลาง · ยกเลิกแล้วเลือกไพ่ใหม่' : requirement(state);
      }
    }
    const candidates = state.openingRequired && !ids.length ? moves.length ? [0] : [] : [...new Set(matches.flat())];
    return { legal, candidates, message, invalid, label: legal ? 'ลง' + setName(cards) + ' →' : ids.length ? matches.length ? 'เลือกเพิ่มอีก ' + (Math.min(...matches.map(move => move.length)) - ids.length) + ' ใบ' : 'เลือกไพ่ใหม่' : 'เลือกไพ่เพื่อลง' };
  }
  function benefit(place) {
    return [
      '',
      'รอบหน้า รับไพ่สูงสุด 2 ใบจากสลาฟ · คุณเลือกคืน 2 ใบ',
      'รอบหน้า รับไพ่สูงสุด 1 ใบจากรองสลาฟ · คุณเลือกคืน 1 ใบ',
      'รอบหน้า ส่งไพ่สูงสุด 1 ใบให้ควีนอัตโนมัติ · รับคืน 1 ใบ',
      'รอบหน้า ส่งไพ่สูงสุด 2 ใบให้คิงอัตโนมัติ · รับคืน 2 ใบ แล้วคุณเปิดกองก่อน'
    ][place] || '';
  }
  function exchange(state, playerId) {
    const self = state.seats.find(p => p.playerId === playerId), title = self?.title;
    if (state.self?.exchangeCount) return title === 'คิง' ? 'รับไพ่สูงสุด 2 ใบจากสลาฟ · เลือกจากมือเดิมคืน 2 ใบ' : 'รับไพ่สูงสุด 1 ใบจากรองสลาฟ · เลือกจากมือเดิมคืน 1 ใบ';
    if (title === 'คิง' || title === 'ควีน') return 'เลือกคืนเรียบร้อย · รออีกคนเลือกให้ครบ แล้วระบบจะแลกพร้อมกัน';
    if (title === 'สลาฟ') return 'ส่งไพ่สูงสุด 2 ใบให้คิงอัตโนมัติ · รอรับคืน 2 ใบ แล้วคุณเปิดกองก่อน';
    return 'ส่งไพ่สูงสุด 1 ใบให้ควีนอัตโนมัติ · รอรับคืน 1 ใบ';
  }
  return { analyze, requirement, setName, benefit, exchange };
});
