#!/usr/bin/env bash
# Keep An Eye — créé par Willem Vanbaelinghem.
# Installe les hooks Keep An Eye dans Claude Code, à lancer DANS le conteneur claude-box :
#
#   docker compose -f ~/claude-box/compose.yml exec -u claude claude bash /workspace/<projet>/…/install-claude-hooks.sh
#   (ou copie le script dans le conteneur et lance-le en tant qu'utilisateur claude)
#
# Il ajoute à ~/.claude/settings.json un hook pour SessionStart, UserPromptSubmit, PreToolUse, Stop,
# Notification et SessionEnd, sans toucher aux autres réglages (une sauvegarde est faite à côté).
# Chaque événement ajoute une ligne JSON compacte à /events/claude.jsonl, enrichie de $KEEP_AN_EYE_SESSION.
#
#   --uninstall   retire uniquement les hooks Keep An Eye
#   --events FILE fichier d'événements (défaut : /events/claude.jsonl)
set -euo pipefail

EVENTS_FILE=/events/claude.jsonl
MODE=install
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) MODE=uninstall ;;
    --events) EVENTS_FILE="$2"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done

command -v jq >/dev/null || { echo "jq est requis (apt-get install -y jq)." >&2; exit 1; }

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CLAUDE_DIR/settings.json"
HOOK="$CLAUDE_DIR/keep-an-eye-hook.sh"
EVENTS=(SessionStart UserPromptSubmit PreToolUse Stop Notification SessionEnd)
mkdir -p "$CLAUDE_DIR"

if [ "$MODE" = install ]; then
  # The hook itself: small, never blocks Claude (always exits 0), writes nothing on stdout
  # (stdout of some hooks is added to Claude's context). Only the fields the app needs are kept,
  # strings are truncated, so file contents written by Claude never end up in the events file.
  cat > "$HOOK" <<HOOK_EOF
#!/bin/sh
# Keep An Eye — généré par install-claude-hooks.sh. Ajoute une ligne JSON par événement Claude Code.
# Always drain stdin: Claude Code writes the event there and must never hit a closed pipe.
EVENTS_FILE="\${KEEP_AN_EYE_EVENTS:-$EVENTS_FILE}"
if [ -z "\$KEEP_AN_EYE_SESSION" ] || [ ! -d "\$(dirname "\$EVENTS_FILE")" ]; then
  cat > /dev/null
  exit 0
fi
jq -c --arg s "\$KEEP_AN_EYE_SESSION" '
  def clip(n): if type == "string" then .[0:n] else null end;
  {
    hook_event_name, session_id, transcript_path, cwd,
    prompt: (.prompt | clip(2000)),
    tool_name,
    tool_input: ((.tool_input // {}) | if type == "object" then
      with_entries(select(.key | IN("command","file_path","notebook_path","pattern","url","query","description"))
        | select(.value | type == "string") | .value |= .[0:500])
      else {} end),
    message: (.message | clip(2000)),
    notification_type, source, reason,
    error: (.error | clip(500))
  }
  | with_entries(select(.value != null and .value != {}))
  + {KEEP_AN_EYE_SESSION: \$s, ts: now}
' >> "\$EVENTS_FILE" 2>/dev/null || true
exit 0
HOOK_EOF
  chmod 755 "$HOOK"
fi

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
jq empty "$SETTINGS" 2>/dev/null || { echo "$SETTINGS n'est pas un JSON valide, rien n'a été modifié." >&2; exit 1; }
BACKUP="$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
cp "$SETTINGS" "$BACKUP"

EVENTS_JSON=$(printf '%s\n' "${EVENTS[@]}" | jq -R . | jq -s .)
TMP=$(mktemp "$CLAUDE_DIR/settings.json.XXXXXX")

if [ "$MODE" = install ]; then
  jq --arg cmd "$HOOK" --argjson events "$EVENTS_JSON" '
    .hooks = (.hooks // {})
    | reduce $events[] as $e (.;
        # Skip events that already run our hook (idempotent).
        if ([.hooks[$e][]?.hooks[]?.command] | index($cmd)) then .
        else .hooks[$e] = ((.hooks[$e] // []) + [
          (if $e == "PreToolUse" then {matcher: "*"} else {} end)
          + {hooks: [{type: "command", command: $cmd, timeout: 10}]}
        ]) end)
  ' "$SETTINGS" > "$TMP"
else
  jq --arg cmd "$HOOK" '
    if .hooks then
      .hooks |= (with_entries(
          .value |= (map(.hooks |= map(select(.command != $cmd))) | map(select((.hooks | length) > 0)))
        ) | with_entries(select((.value | length) > 0)))
      | if .hooks == {} then del(.hooks) else . end
    else . end
  ' "$SETTINGS" > "$TMP"
fi

jq empty "$TMP"
mv "$TMP" "$SETTINGS"

if [ "$MODE" = install ]; then
  echo "✓ Hooks Keep An Eye installés dans $SETTINGS (sauvegarde : $BACKUP)"
  echo "  Script : $HOOK → $EVENTS_FILE"
  [ -d "$(dirname "$EVENTS_FILE")" ] || echo "  ⚠ $(dirname "$EVENTS_FILE") n'existe pas : ajoute le volume ./events:/events au compose.yml (voir README)."
  echo "  Les sessions Claude déjà ouvertes doivent être relancées pour prendre les hooks en compte."
else
  rm -f "$HOOK"
  echo "✓ Hooks Keep An Eye retirés de $SETTINGS (sauvegarde : $BACKUP)"
fi
