/**
 * Signed door links (/open?name&host&reason&timestamp&startTime&duration[&eventUrl][&booking]&sig).
 *
 * Two issuers use them:
 *  - Luma event emails (scripts/send-event-access-emails.js): host = the event's host
 *  - the Discord /book command (opencollective/token-bot): links for the guest of a room booking,
 *    marked with booking=1; host = the member who booked, reason = "<room> booking today from 5-7pm"
 */

/** The exact string the issuer signed. booking=1 is part of the signature so it cannot be added or removed. */
export function signedMessage(p) {
  let message = `name=${p.name}&host=${p.host}&reason=${p.reason}&timestamp=${p.timestamp}&startTime=${p.startTime}&duration=${p.duration}`;
  if (p.eventUrl) message += `&eventUrl=${p.eventUrl}`;
  if (p.booking === "1") message += `&booking=1`;
  return message;
}

/** The line posted in the door channel when someone opens with a signed link. */
export function openedMessage(q) {
  if (q.booking === "1") {
    return `🚪 ${q.name} opened the door for ${q.reason} (booked by ${q.host})`;
  }
  const eventLink = q.eventUrl ? `[${q.reason}](<${q.eventUrl}>)` : q.reason;
  return `🚪 ${q.name} opened the door for ${eventLink} hosted by ${q.host}`;
}
