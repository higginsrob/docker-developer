# Docker Developer ZSH Aliases

```bash

alias c="clear"

alias d="docker"

alias de="docker exec -it"

alias di="docker images"
alias drmi="docker rmi"
alias drmia='docker rmi $(docker images -q)'

alias dm="docker model"
alias dml="docker model list"
alias dmp="docker model pull"
alias dmr="docker model run"
alias dms="docker model serve"

alias gpt="docker model run ai/gpt-oss:latest"
alias gemma="docker model run ai/gemma3"
alias mistral="docker model run ai/mistral:latest"
alias deepcoder="docker model run ai/deepcoder-preview:latest"
alias moondream="docker model run ai/moondream2:latest"

alias dn="docker network"
alias dns="docker network ls"

alias dsp="docker system prune -f"

alias ds='docker ps --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}"'
alias dsa='docker ps -a --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}"'

alias dv="docker volume"
alias dvs="docker volume ls"
alias dvp="docker volume prune --filter 'label!=higginsrob'"

alias dc="docker compose"
alias dcb="docker compose build"
alias dcd="docker compose down"
alias dcdv="docker compose down --volumes"
alias dce="docker compose exec"
alias dcl="docker compose logs"
alias dcu="docker compose up -d"
alias dcw="docker compose watch"

alias x="exit"

```
