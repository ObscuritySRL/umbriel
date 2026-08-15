# Discord workflows verified on 2026-08-15

These findings come from the current Discord Electron client and use accessibility first. Picker tiles are the one confirmed exception where a screenshot plus `inspect_point` was needed.

## Messages and navigation

- Attach directly to a known chat with `attach {hWnd, root:"Messages in <chat>", tail:20, maxDepth:2}`. This avoids rendering the broad Discord tree first.
- Read chronological lists with `desktop_snapshot {root:"Messages in <chat>", tail:20, maxDepth:3}`. Keep `maxNodes` high enough to traverse every loaded message; a low node cap can stop before the newest direct children.
- A Discord Slate composer is an `Edit "Message @<recipient>"`. Send with `type {method:"paste", clear:true, verify:true, submit:true, restoreForeground:true}` and confirm the new message id in a fresh scoped tail.

## Reactions

- Hovering/right-clicking a message exposes `Menu "Message Actions"`. `Copy Message ID` identifies the target message, and quick reactions appear as `MenuItem "Add Reaction: …"`.
- Invoke exactly one quick-reaction item, then verify the target message contains a reaction button such as `"fire, 1 reaction, press to remove your reaction"`.
- Discord may expose an off-screen message row as disabled with zero bounds. Do not force-click that row; surface its action menu and verify the menu's message id instead.

## GIFs and stickers

- `Button "Open GIF picker"` opens the GIF tab. Its search edit is currently named `Search Klipy`.
- GIF result tiles have no useful UIA name. Use one screenshot only after the accessible search succeeds, then `inspect_point` the intended tile. A GIF tile maps to class `gif__…`; `click_point` sends it immediately. Verify a new message containing a `Button "GIF"`.
- `Button "Open sticker picker"` opens stickers. Its search edit is named `Search`.
- Sticker tiles map through `inspect_point` to a descriptive button such as `Sticker, <name>, <description>` with class `sticker_…`. `click_point` sends immediately. Verify the new message repeats that sticker name and description.

## Generated image attachments

- To paste a generated local PNG exactly like a human, put its absolute path on the clipboard with `copy_files {paths:[...]}` (CF_HDROP), focus the target Discord composer, then press `Control+V`.
- Verify Discord shows an attachment preview whose accessible name contains the expected filename before pressing Enter. After submission, verify a new message row containing `Image`; this avoids both duplicate sends and accidental upload of the wrong clipboard file.
- Electron may update the selected DM after the input action returns. If the immediate snapshot still reports the old title, wait briefly and take a fresh snapshot instead of clicking the conversation again.

## Channel search

- The top search control is a `ComboBox "Search <recipient>"`. Click it, type the query with `submit:false` and input verification, then call `press_key {key:"Enter"}` separately.
- Do not use message-style submit verification for search: Discord intentionally retains the query after Enter. Verify instead with `desktop_snapshot {root:"Search Results"}` and inspect the result count/items.
- Escape closes transient menus/search panels before returning to the parked chat.
