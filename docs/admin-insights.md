# Admin insights

The default **ภาพรวม** in `/admin` shows the dashboard; `/admin/insights` opens the same dashboard separately. This is an admin-session-only, read-only page. `/admin/api/insights` is protected by the same session middleware as admin exports and uses `Cache-Control: no-store`.

The UI prioritizes numeric metrics, paired daily bars, game ranking bars, hourly usage and a compact activity table. Event messages and full participants are collapsed until the details icon is clicked; definitions stay in this document and short tooltips, not paragraphs in the dashboard.

The overview shows room occupants at request time, game starts, game-end events, identified human activity, join/leave events and errors. Daily buckets and hourly activity use **Asia/Bangkok**. A day filter includes calendar days through today, not a rolling browser-local interval. Click a game or player to narrow the activity feed; activity type, player ID, text search and pagination are server-side. CSV exports the displayed page only. Page URLs use `focusPlayer` for the activity filter; `playerId` is reserved for the shared browser identity flow and is never interpreted as an insights filter.

## Meaning and limitations

- Popularity is based on explicit `game_start` events. Gameplay chat/detail volume does not increase the ranking. Solo games currently record results rather than explicit starts; show these result counts separately rather than fabricating starts.
- End events can represent a poker hand or a complete game. End/start is **not** a completion rate. Do not present it as one.
- Unique humans are counted from stable recorded actor/participant IDs; bots are excluded. These are observed activities, not page visits or concurrent online users. Older logs contain names without stable IDs and cannot be reliably assigned to a particular account.
- Start/end logs now carry a bounded `participantIds` list of human IDs (up to 20 seats). Join/leave logs carry actor ID/name. No recovery code, Google token, room password or private player object is added to analytics DTOs.
- The source is the existing retained log store. Its configured time retention is usually **7 days**, with separate bucket and per-room caps that can evict data sooner. The UI states its coverage. Clearing logs also removes this source history; this is not an all-time analytics warehouse.
- The old admin summary used sum(player games)/2 as “games played”, which is not valid for variable-size multiplayer tables. It now shows the sum as **จำนวนครั้งที่เล่นรวม**. Player stats themselves are not rewritten.
- Source scans are cached and coalesced to keep repeated admin reads from reloading the full log history. New events can take up to the cache period to appear.

## Verification

Run `npm run smoke:admin:analytics` and `npm run smoke:admin:insights:browser` with database environment variables empty. The browser suite owns isolated temporary data and tests authorization, filtering, pagination, hostile values, responsive layouts and empty/error states. The unit, browser, table, and performance checks are included in release CI. `npm run smoke:admin:perf` verifies a many-thousand-player/log fixture while measuring concurrent `/ping` responsiveness.

Next gap: retain compact daily aggregates independently of diagnostic logs for 30/90-day trend and retention analysis. This should have its own retention policy and must not silently claim historical data that no longer exists.

## Thai terms

Use ห้อง for a virtual room, เกม for a complete game, and รอบ for repeated card rounds. Visible states use เริ่มเล่น, เล่นจบ, รอบถัดไป and จบเกม. Keep established terms such as เจ้ามือ and ไพ่ในมือ, and proper names such as อัศวินโต๊ะกลม. Engine event names and persisted identifiers are unchanged.
