# Firn IDE shell integration — user .zshenv should see the user's ZDOTDIR, but
# zsh must still load Firn's wrapper .zshrc afterwards.
__firn_zdotdir="$ZDOTDIR"
ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$__firn_zdotdir"
unset __firn_zdotdir
