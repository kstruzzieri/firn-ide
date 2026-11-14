# Firn IDE shell integration — user .zshenv should see the user's ZDOTDIR, but
# zsh must still load Firn's wrapper .zshrc afterwards.
__firn_zdotdir="$ZDOTDIR"
ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$__firn_zdotdir"
unset __firn_zdotdir

# Firn is not Apple's Terminal, but a Firn started from a shell inside it hands
# TERM_PROGRAM and TERM_SESSION_ID on to this one, and /etc/zshrc then loads
# Terminal's per-tab session support. That builds its session and history paths
# from ZDOTDIR, which is still this wrapper directory when it runs, and every
# Firn terminal would share the one tab's session. This is the switch
# /etc/zshrc_Apple_Terminal documents for turning it off.
if [[ "${TERM_PROGRAM-}" == Apple_Terminal ]]; then
  SHELL_SESSIONS_DISABLE=1
fi
