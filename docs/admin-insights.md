# Admin insights

The default **ภาพรวม** in `/admin` shows the dashboard; `/admin/insights` opens the same dashboard separately. This is an admin-session-only, read-only page. `/admin/api/insights` is protected by the same session middleware as admin exports and uses `Cache-Control: no-store`.

The UI prioritizes numeric metrics, paired daily bars (or a line chart for longer ranges), game ranking bars, hourly usage and a compact activity table. Event messages and full participants are collapsed until the details icon is clicked; definitions stay in this document and short tooltips, not paragraphs in the dashboard.

The overview shows room occupants at request time, game starts, game-end events, identified human activity, join/leave events and errors. Daily buckets and hourly activity use **Asia/Bangkok**. A day filter includes calendar days through today, not a rolling browser-local interval. **ทั้งหมด** covers all available archived records, grouped by month. **เลือกเดือน** accepts any calendar month and groups by day; month boundaries use Bangkok midnight. Links preserve the selected period and month. Click a game or player to narrow the activity feed; activity type, player ID, text search and pagination are server-side. CSV exports the displayed page only. Page URLs use `focusPlayer` for the activity filter; `playerId` is reserved for the shared browser identity flow and is never interpreted as an insights filter.

## Meaning and limitations

- Popularity is based on explicit `game_start` events. Gameplay chat/detail volume does not increase the ranking. Solo games currently record results rather than explicit starts; show these result counts separately rather than fabricating starts.
- End events can represent a poker hand or a complete game. End/start is **not** a completion rate. Do not present it as one.
- Unique humans are counted from stable recorded actor/participant IDs; bots are excluded. These are observed activities, not page visits or concurrent online users. Older logs contain names without stable IDs and cannot be reliably assigned to a particular account. Recognized join/leave/Liar history formats display their recorded name as plain text, without linking to a possibly unrelated account. New Liar actions record the actual actor ID and name.
- Start/end logs now carry a bounded `participantIds` list of human IDs (up to 20 seats). Join/leave logs carry actor ID/name. No recovery code, Google token, room password or private player object is added to analytics DTOs.
- Activity has its own `ActivityArchive` Mongo collection with a timestamp/order index and **no TTL or diagnostic quota**. Without Mongo it uses `GAME_DATA_DIR/activityArchive.ndjson`; this file must be on persistent storage. Every new normalized server log is captured before diagnostic pruning. Clearing diagnostic logs does not clear the archive. Startup imports all still-retained logs idempotently; expired or previously deleted history cannot be reconstructed. A partial in-memory database fallback is rejected during import, and the API refuses incomplete history until import succeeds.
- The dashboard uses current public profile fields: emoji, frame, color and an allowed Google image URL only when the owner has enabled it. Private Google identity fields and recovery codes are never archived or returned. Cache reads reapply current profile preferences, including photo opt-out.
- The old admin summary used sum(player games)/2 as “games played”, which is not valid for variable-size multiplayer tables. It now shows the sum as **จำนวนครั้งที่เล่นรวม**. Player stats themselves are not rewritten.
- Mongo scans stream indexed records in batches of 500, with no 100,000-record cutoff; only the requested 50 activities and a final-page buffer are retained. An LRU of 16 query reports lasts 15 seconds; refresh bypasses it and search always scans fresh. Failed archive writes stay queued for retry and fail report requests rather than presenting incomplete counts. File fallback keeps the archive in memory, so Mongo is recommended for production.

## Verification

Run `npm run smoke:admin:archive`, `npm run smoke:admin:analytics` and `npm run smoke:admin:insights:browser` with database environment variables empty. The browser suite owns isolated temporary data and tests authorization, filtering, pagination, hostile values, responsive layouts and empty/error states. The unit, browser, table, and performance checks are included in release CI. `npm run smoke:admin:perf` verifies a many-thousand-player/log fixture while measuring concurrent `/ping` responsiveness.

Next gap: maintain incremental daily aggregates so all-time charts do not need to rescan the growing event archive. Back up the independent archive along with other production data.

## Thai terms

Use ห้อง for a virtual room, เกม for a complete game, and รอบ for repeated card rounds. Visible states use เริ่มเล่น, เล่นจบ, รอบถัดไป and จบเกม. Keep established terms such as เจ้ามือ and ไพ่ในมือ, and proper names such as อัศวินโต๊ะกลม. Engine event names and persisted identifiers are unchanged.
