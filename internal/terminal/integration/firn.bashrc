# Firn IDE shell integration (OSC 133)
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

if [[ -z "$FIRN_SHELL_INTEGRATION" ]]; then
  # Do not clobber an existing DEBUG trap — bail to plain user config if present.
  __firn_prompt_decl="$(declare -p PROMPT_COMMAND 2>/dev/null || true)"
  if [[ -z "$(trap -p DEBUG)" && "$__firn_prompt_decl" != declare\ -a* && "$__firn_prompt_decl" != declare\ -A* ]]; then
    FIRN_SHELL_INTEGRATION=1
    __firn_osc() { printf '\033]133;%s\007' "$1"; }
    __firn_user_prompt_command="$PROMPT_COMMAND"
    __firn_preexec_done=1
    __firn_in_prompt_command=0
    __firn_preexec() {
      [[ -n "$COMP_LINE" ]] && return
      [[ "$BASH_COMMAND" == __firn_precmd ]] && return
      [[ $__firn_in_prompt_command -eq 1 ]] && return
      [[ $__firn_preexec_done -eq 1 ]] && return
      __firn_preexec_done=1
      __firn_osc C
    }
    __firn_precmd() {
      local s=$?
      __firn_in_prompt_command=1
      __firn_osc "D;$s"
      __firn_osc A
      [[ -n "$__firn_user_prompt_command" ]] && eval "$__firn_user_prompt_command"
      __firn_preexec_done=0
      __firn_in_prompt_command=0
      return $s
    }
    trap '__firn_preexec' DEBUG
    PROMPT_COMMAND="__firn_precmd"
  fi
  unset __firn_prompt_decl
fi
