# GIZMO PROTECTED CONFIG — DO NOT CHANGE WITHOUT WILL'S PERMISSION

## TG Reply Model
- **Model:** grok-4
- **API:** https://api.x.ai/v1/chat/completions
- **Max tokens:** 2000
- **Timeout:** 30s

## Soul Prompt Source Files (ALL must be loaded)
- ~/.openclaw/workspace/IDENTITY.md
- ~/.openclaw/workspace/SOUL.md
- ~/.openclaw/workspace/agents/CONSTITUTION.md
- ~/.openclaw/workspace/RULES.md

## TG Behavior
- NO reply_to_message_id (sends own messages, not quote-replies)
- sendChatAction typing before AI call
- No canned TG_REPLIES — everything goes through AI
- No static fallback — if AI fails, stay silent

## Trading Filters (as of March 14, 2026)
- MC floor: $2,000
- 9-signal minimum: 3
- Tier minimum size: 0.1 SOL (2+ wallet), 0.05 SOL (<2)
- Muted KOLs contribute to convergence with weight 1
- Max positions: 5

## RECOVERY COMMAND
If Gizmo's personality breaks, run:
node /tmp/fix-soul-escape.js
Then restart gizmo.mjs

## NEVER CHANGE
- The model (grok-4)
- The soul file loading
- The TG reply format (own messages, not replies)
- The typing indicator
