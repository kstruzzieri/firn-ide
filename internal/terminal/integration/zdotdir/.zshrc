# Firn IDE shell integration (OSC 133)

# The system-wide zshrc ran while ZDOTDIR was still this wrapper directory.
# Stock macOS and the grml config set HISTFILE from ZDOTDIR there, which would
# keep the history of Firn terminals in Firn's cache directory, apart from every
# other terminal's. Move it under the user's directory, before their .zshrc so
# that a HISTFILE of their own still wins. The user's .zshenv has already run and
# may have set options: the prefix is cut by length because a pattern would be
# globbed under GLOB_SUBST, and the tests use ${name-} because a bare $HISTFILE,
# unset on Ubuntu and Alpine, is an error under NO_UNSET.
if [[ -n "${ZDOTDIR-}" && "${HISTFILE-}" == "$ZDOTDIR"/* ]]; then
  HISTFILE="${USER_ZDOTDIR:-$HOME}${HISTFILE:${#ZDOTDIR}}"
fi
ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"

# Install hooks AFTER user rc, PREPENDED so __firn_precmd reads $? before any
# prompt tooling (p10k/starship) mutates it.
if [[ -z "$FIRN_SHELL_INTEGRATION" ]]; then
  FIRN_SHELL_INTEGRATION=1
  __firn_osc() { printf '\033]133;%s\007' "$1"; }
  __firn_preexec() { __firn_osc C; }
  __firn_precmd()  { local s=$?; __firn_osc "D;$s"; __firn_osc A; }
  typeset -ga precmd_functions preexec_functions
  precmd_functions=(__firn_precmd ${precmd_functions[@]})
  preexec_functions=(__firn_preexec ${preexec_functions[@]})
fi
