# Firn IDE shell integration (OSC 133)
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
