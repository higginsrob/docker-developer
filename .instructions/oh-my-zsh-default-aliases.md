# Oh My Zsh Aliases

-='cd -'                                                                                                                                                            # go to previous working directory

...=../..                                                                                                                                                           # go up two directories
....=../../..                                                                                                                                                       # go up three directories
.....=../../../..                                                                                                                                                   # go up 4 directories
......=../../../../..                                                                                                                                               # go up 5 directories

1='cd -1'                                                                                                                                                           # go back into directory history stack one level
2='cd -2'                                                                                                                                                           # go back into directory history stack two levels
3='cd -3'                                                                                                                                                           # go back into directory history stack three levels
4='cd -4'                                                                                                                                                           # go back into directory history stack four levels
5='cd -5'                                                                                                                                                           # go back into directory history stack five levels
6='cd -6'                                                                                                                                                           # go back into directory history stack six levels
7='cd -7'                                                                                                                                                           # go back into directory history stack seven levels
8='cd -8'                                                                                                                                                           # go back into directory history stack eight levels
9='cd -9'                                                                                                                                                           # go back into directory history stack nine levels

_='sudo '                                                                                                                                                           # run command as sudo

egrep='grep -E'                                                                                                                                                     # search input file for pattern
fgrep='grep -F'                                                                                                                                                     # search by string instead of regex pattern

g=git                                                                                                                                                               # version control app

ga='git add'                                                                                                                                                        # stage files (add to next commit)
gaa='git add --all'                                                                                                                                                 # add all modified, deleted and untracked files to stage

gam='git am'                                                                                                                                                        # apply a series of patches from a mailbox
gama='git am --abort'                                                                                                                                               # abort applying a series of patches from a mailbox
gamc='git am --continue'                                                                                                                                            # continue to next step while applying a series of patches from a mailbox
gams='git am --skip'                                                                                                                                                # skip current patch while applying a series of patches from a mailbox
gamscp='git am --show-current-patch'                                                                                                                                # show the current patch while applying a series of patches from a mailbox

gap='git apply'                                                                                                                                                     # apply a patch to files in the working directory
gapa='git add --patch'                                                                                                                                              # interactively stage hunks of changes
gapt='git apply --3way'                                                                                                                                             # apply a patch with 3-way merge fallback

gau='git add --update'                                                                                                                                              # stage modified and deleted files only
gav='git add --verbose'                                                                                                                                             # stage files with verbose output

gb='git branch'                                                                                                                                                     # list, create, or delete branches
gbD='git branch --delete --force'                                                                                                                                   # force delete a branch (even if not merged)
gba='git branch --all'                                                                                                                                              # list all local and remote branches
gbd='git branch --delete'                                                                                                                                           # delete a branch (fails if not merged)
gbm='git branch --move'                                                                                                                                             # rename a branch
gbnm='git branch --no-merged'                                                                                                                                       # list branches not merged into current branch
gbr='git branch --remote'                                                                                                                                           # list remote branches

gbg='LANG=C git branch -vv | grep ": gone\]"'                                                                                                                       # list branches with gone upstream tracking branches
gbgD='LANG=C git branch --no-color -vv | grep ": gone\]" | cut -c 3- | awk '\''{print $1}'\'' | xargs git branch -D'                                                # force delete branches with gone upstream
gbgd='LANG=C git branch --no-color -vv | grep ": gone\]" | cut -c 3- | awk '\''{print $1}'\'' | xargs git branch -d'                                                # delete branches with gone upstream

gbl='git blame -w'                                                                                                                                                  # show who last modified each line, ignoring whitespace

gbs='git bisect'                                                                                                                                                    # binary search to find the commit that introduced a bug
gbsb='git bisect bad'                                                                                                                                               # mark current commit as bad during bisect
gbsg='git bisect good'                                                                                                                                              # mark current commit as good during bisect
gbsn='git bisect new'                                                                                                                                               # mark current commit as new during bisect
gbso='git bisect old'                                                                                                                                               # mark current commit as old during bisect
gbsr='git bisect reset'                                                                                                                                             # reset bisect session to original branch
gbss='git bisect start'                                                                                                                                             # start a bisect session

gc='git commit --verbose'                                                                                                                                           # commit staged changes with verbose diff output
'gc!'='git commit --verbose --amend'                                                                                                                                # amend the last commit with verbose diff output

gcB='git checkout -B'                                                                                                                                               # create/reset and checkout a branch
gcb='git checkout -b'                                                                                                                                               # create and checkout a new branch
gcd='git checkout $(git_develop_branch)'                                                                                                                            # checkout the develop branch
gcm='git checkout $(git_main_branch)'                                                                                                                               # checkout the main branch (main/master)
gco='git checkout'                                                                                                                                                  # checkout a branch or restore files
gcor='git checkout --recurse-submodules'                                                                                                                            # checkout with submodule recursion

gca='git commit --verbose --all'                                                                                                                                    # commit all changes with verbose output
'gca!'='git commit --verbose --all --amend'                                                                                                                         # amend last commit with all changes, verbose output
gcam='git commit --all --message'                                                                                                                                   # commit all changes with a message
'gcan!'='git commit --verbose --all --no-edit --amend'                                                                                                              # amend last commit with all changes, no edit, verbose
'gcann!'='git commit --verbose --all --date=now --no-edit --amend'                                                                                                  # amend last commit with all changes, update date to now
'gcans!'='git commit --verbose --all --signoff --no-edit --amend'                                                                                                   # amend last commit with all changes, add signoff
gcas='git commit --all --signoff'                                                                                                                                   # commit all changes with signoff
gcasm='git commit --all --signoff --message'                                                                                                                        # commit all changes with signoff and message
gcfu='git commit --fixup'                                                                                                                                           # create a fixup commit for a specific commit
gcmsg='git commit --message'                                                                                                                                        # commit with a message
gcn='git commit --verbose --no-edit'                                                                                                                                # commit with verbose output, reuse last message
'gcn!'='git commit --verbose --no-edit --amend'                                                                                                                     # amend last commit with verbose output, reuse message
gcs='git commit --gpg-sign'                                                                                                                                         # commit with GPG signature
gcsm='git commit --signoff --message'                                                                                                                               # commit with signoff and message
gcss='git commit --gpg-sign --signoff'                                                                                                                              # commit with GPG signature and signoff
gcssm='git commit --gpg-sign --signoff --message'                                                                                                                   # commit with GPG signature, signoff, and message

gcf='git config --list'                                                                                                                                             # list all git configuration settings

gcl='git clone --recurse-submodules'                                                                                                                                # clone repository with submodules
gclf='git clone --recursive --shallow-submodules --filter=blob:none --also-filter-submodules'                                                                       # clone with minimal submodules (filtered)

gclean='git clean --interactive -d'                                                                                                                                 # interactively remove untracked files and directories

gcount='git shortlog --summary --numbered'                                                                                                                          # show commit count summary grouped by author

gcp='git cherry-pick'                                                                                                                                               # apply changes from specific commits
gcpa='git cherry-pick --abort'                                                                                                                                      # abort cherry-pick operation
gcpc='git cherry-pick --continue'                                                                                                                                   # continue cherry-pick after resolving conflicts

gd='git diff'                                                                                                                                                       # show changes between working directory and staging area
gdca='git diff --cached'                                                                                                                                            # show changes in staging area
gdcw='git diff --cached --word-diff'                                                                                                                                # show word-level diff of staged changes
gds='git diff --staged'                                                                                                                                             # show staged changes (alias for --cached)
gdt='git diff-tree --no-commit-id --name-only -r'                                                                                                                   # show files changed in a commit tree
gdup='git diff @{upstream}'                                                                                                                                         # show diff between current branch and upstream
gdw='git diff --word-diff'                                                                                                                                          # show word-level diff of working directory changes

gdct='git describe --tags $(git rev-list --tags --max-count=1)'                                                                                                     # describe the latest tag

gf='git fetch'                                                                                                                                                      # download objects and refs from remote
gfa='git fetch --all --tags --prune --jobs=10'                                                                                                                      # fetch from all remotes with tags, prune, 10 parallel jobs
gfo='git fetch origin'                                                                                                                                              # fetch from origin remote

gfg='git ls-files | grep'                                                                                                                                           # search tracked files by pattern

gg='git gui citool'                                                                                                                                                 # launch git GUI commit tool
gga='git gui citool --amend'                                                                                                                                        # launch git GUI commit tool to amend last commit

ggpull='git pull origin "$(git_current_branch)"'                                                                                                                    # pull from origin for current branch
ggpur=ggu                                                                                                                                                           # deprecated alias, use ggu instead

ggpush='git push origin "$(git_current_branch)"'                                                                                                                    # push current branch to origin

ggsup='git branch --set-upstream-to=origin/$(git_current_branch)'                                                                                                   # set upstream tracking for current branch

ghh='git help'                                                                                                                                                      # show git help

gignore='git update-index --assume-unchanged'                                                                                                                       # mark file as unchanged (hide from git status)
gignored='git ls-files -v | grep "^[[:lower:]]"'                                                                                                                    # list ignored files (assume-unchanged)

git-svn-dcommit-push='git svn dcommit && git push github $(git_main_branch):svntrunk'                                                                               # commit to svn and push to github

gk='\gitk --all --branches &!'                                                                                                                                      # launch gitk visual tool for all branches
gke='\gitk --all $(git log --walk-reflogs --pretty=%h) &!'                                                                                                          # launch gitk with reflog commits

gl='git pull'                                                                                                                                                       # pull changes from remote

glg='git log --stat'                                                                                                                                                # show commit log with file statistics
glgg='git log --graph'                                                                                                                                              # show commit log with graph
glgga='git log --graph --decorate --all'                                                                                                                            # show commit log with graph, decorations, all branches
glgm='git log --graph --max-count=10'                                                                                                                               # show last 10 commits with graph
glgp='git log --stat --patch'                                                                                                                                       # show commit log with stats and patches
glo='git log --oneline --decorate'                                                                                                                                  # show one-line commit log with decorations
glod='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset"'                                                       # colored log with graph, hash, date, author
glods='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset" --date=short'                                         # colored log with short date format
glog='git log --oneline --decorate --graph'                                                                                                                         # one-line log with graph and decorations
gloga='git log --oneline --decorate --graph --all'                                                                                                                  # one-line log with graph for all branches
glol='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset"'                                                       # colored log with relative time
glola='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset" --all'                                                # colored log with relative time for all branches
glols='git log --graph --pretty="%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset" --stat'                                               # colored log with relative time and stats
glp=_git_log_prettily                                                                                                                                               # pretty log format function

globurl='noglob urlglobber '                                                                                                                                        # disable globbing for URL globber

gluc='git pull upstream $(git_current_branch)'                                                                                                                      # pull from upstream for current branch
glum='git pull upstream $(git_main_branch)'                                                                                                                         # pull from upstream for main branch

gm='git merge'                                                                                                                                                      # merge branches
gma='git merge --abort'                                                                                                                                             # abort merge operation
gmc='git merge --continue'                                                                                                                                          # continue merge after resolving conflicts
gmff='git merge --ff-only'                                                                                                                                          # merge only if fast-forward is possible
gmom='git merge origin/$(git_main_branch)'                                                                                                                          # merge origin main branch into current branch
gms='git merge --squash'                                                                                                                                            # squash merge commits into one
gmum='git merge upstream/$(git_main_branch)'                                                                                                                        # merge upstream main branch into current branch

gmtl='git mergetool --no-prompt'                                                                                                                                    # launch merge tool without prompting
gmtlvim='git mergetool --no-prompt --tool=vimdiff'                                                                                                                  # launch vimdiff merge tool without prompting

gp='git push'                                                                                                                                                       # push commits to remote
gpd='git push --dry-run'                                                                                                                                            # simulate push without actually pushing
gpf='git push --force-with-lease --force-if-includes'                                                                                                               # force push with safety checks
'gpf!'='git push --force'                                                                                                                                           # force push (dangerous, overwrites remote)
gpoat='git push origin --all && git push origin --tags'                                                                                                             # push all branches and tags to origin
gpod='git push origin --delete'                                                                                                                                     # delete remote branch on origin
gpsup='git push --set-upstream origin $(git_current_branch)'                                                                                                        # push and set upstream tracking
gpsupf='git push --set-upstream origin $(git_current_branch) --force-with-lease --force-if-includes'                                                                # push with upstream and force-with-lease
gpu='git push upstream'                                                                                                                                             # push to upstream remote
gpv='git push --verbose'                                                                                                                                            # push with verbose output

gpr='git pull --rebase'                                                                                                                                             # pull and rebase current branch
gpra='git pull --rebase --autostash'                                                                                                                                # pull with rebase, auto-stash local changes
gprav='git pull --rebase --autostash -v'                                                                                                                            # pull with rebase, auto-stash, verbose output
gprom='git pull --rebase origin $(git_main_branch)'                                                                                                                 # pull and rebase from origin main branch
gpromi='git pull --rebase=interactive origin $(git_main_branch)'                                                                                                    # interactive rebase from origin main
gprum='git pull --rebase upstream $(git_main_branch)'                                                                                                               # pull and rebase from upstream main
gprumi='git pull --rebase=interactive upstream $(git_main_branch)'                                                                                                  # interactive rebase from upstream main
gprv='git pull --rebase -v'                                                                                                                                         # pull with rebase, verbose output

gpristine='git reset --hard && git clean --force -dfx'                                                                                                              # reset to HEAD and remove all untracked files

gr='git remote'                                                                                                                                                     # manage remote repositories
gra='git remote add'                                                                                                                                                # add a remote repository
grmv='git remote rename'                                                                                                                                            # rename a remote repository
grrm='git remote remove'                                                                                                                                            # remove a remote repository
grset='git remote set-url'                                                                                                                                          # change URL of a remote repository
grup='git remote update'                                                                                                                                            # update remote tracking branches
grv='git remote --verbose'                                                                                                                                          # show remotes with URLs

grb='git rebase'                                                                                                                                                    # rebase commits onto another branch
grba='git rebase --abort'                                                                                                                                           # abort rebase operation
grbc='git rebase --continue'                                                                                                                                        # continue rebase after resolving conflicts
grbd='git rebase $(git_develop_branch)'                                                                                                                             # rebase current branch onto develop
grbi='git rebase --interactive'                                                                                                                                     # interactive rebase (edit commits)
grbm='git rebase $(git_main_branch)'                                                                                                                                # rebase current branch onto main
grbo='git rebase --onto'                                                                                                                                            # rebase onto a specific base
grbom='git rebase origin/$(git_main_branch)'                                                                                                                        # rebase onto origin main branch
grbs='git rebase --skip'                                                                                                                                            # skip current commit during rebase
grbum='git rebase upstream/$(git_main_branch)'                                                                                                                      # rebase onto upstream main branch

grep='grep --color=auto --exclude-dir={.bzr,CVS,.git,.hg,.svn,.idea,.tox,.venv,venv}'                                                                               # grep with colors, excluding version control dirs

grev='git revert'                                                                                                                                                   # revert commits by creating new commits
greva='git revert --abort'                                                                                                                                          # abort revert operation
grevc='git revert --continue'                                                                                                                                       # continue revert after resolving conflicts

grf='git reflog'                                                                                                                                                    # show reference log (history of HEAD)
grh='git reset'                                                                                                                                                     # reset current HEAD to specified state

grhh='git reset --hard'                                                                                                                                             # reset HEAD and working directory (discard changes)
grhk='git reset --keep'                                                                                                                                             # reset HEAD but keep working directory changes
grhs='git reset --soft'                                                                                                                                             # reset HEAD but keep changes staged

grm='git rm'                                                                                                                                                        # remove files from working tree and index
grmc='git rm --cached'                                                                                                                                              # remove files from index only (keep in working tree)

groh='git reset origin/$(git_current_branch) --hard'                                                                                                                # reset current branch to match origin (hard)
gru='git reset --'                                                                                                                                                  # unstage files (reset paths)

grs='git restore'                                                                                                                                                   # restore working tree files
grss='git restore --source'                                                                                                                                         # restore files from a specific source
grst='git restore --staged'                                                                                                                                         # unstage files (restore from index)

grt='cd "$(git rev-parse --show-toplevel || echo .)"'                                                                                                               # change to git repository root directory

gsb='git status --short --branch'                                                                                                                                   # show short status with branch info
gsd='git svn dcommit'                                                                                                                                               # commit changes to SVN repository

gsh='git show'                                                                                                                                                      # show commit details
gsps='git show --pretty=short --show-signature'                                                                                                                     # show commit with short format and signature

gsi='git submodule init'                                                                                                                                            # initialize submodules
gsu='git submodule update'                                                                                                                                          # update submodules

gsr='git svn rebase'                                                                                                                                                # rebase SVN changes

gss='git status --short'                                                                                                                                            # show short status format
gst='git status'                                                                                                                                                    # show working tree status

gsta='git stash push'                                                                                                                                               # stash changes
gstaa='git stash apply'                                                                                                                                             # apply stash without removing it
gstall='git stash --all'                                                                                                                                            # stash including untracked and ignored files
gstc='git stash clear'                                                                                                                                              # remove all stash entries
gstd='git stash drop'                                                                                                                                               # remove a stash entry
gstl='git stash list'                                                                                                                                               # list stash entries
gstp='git stash pop'                                                                                                                                                # apply and remove most recent stash
gsts='git stash show --patch'                                                                                                                                       # show stash diff as patch
gstu='gsta --include-untracked'                                                                                                                                     # stash including untracked files

gsw='git switch'                                                                                                                                                    # switch branches
gswc='git switch --create'                                                                                                                                          # create and switch to new branch
gswd='git switch $(git_develop_branch)'                                                                                                                             # switch to develop branch
gswm='git switch $(git_main_branch)'                                                                                                                                # switch to main branch

gta='git tag --annotate'                                                                                                                                            # create annotated tag
gtl='gtl(){ git tag --sort=-v:refname -n --list "${1}*" }; noglob gtl'  # list tags matching pattern, sorted by version
gts='git tag --sign'                                                                                                                                                # create signed tag
gtv='git tag | sort -V'                                                                                                                                             # list tags sorted by version

gunignore='git update-index --no-assume-unchanged'                                                                                                                  # stop ignoring changes to a file

gunwip='git rev-list --max-count=1 --format="%s" HEAD | grep -q "\--wip--" && git reset HEAD~1'                                                                     # undo last commit if it's a WIP commit

gup=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gup%F{yellow}\' is a deprecated alias, using \'%F{green}gpr%F{yellow}\' instead.%f"\n    gpr'                # deprecated: use gpr instead (pull with rebase)
gupa=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gupa%F{yellow}\' is a deprecated alias, using \'%F{green}gpra%F{yellow}\' instead.%f"\n    gpra'            # deprecated: use gpra instead (pull with rebase and autostash)
gupav=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gupav%F{yellow}\' is a deprecated alias, using \'%F{green}gprav%F{yellow}\' instead.%f"\n    gprav'        # deprecated: use gprav instead (pull with rebase, autostash, verbose)
gupom=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gupom%F{yellow}\' is a deprecated alias, using \'%F{green}gprom%F{yellow}\' instead.%f"\n    gprom'        # deprecated: use gprom instead (pull and rebase from origin main)
gupomi=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gupomi%F{yellow}\' is a deprecated alias, using \'%F{green}gpromi%F{yellow}\' instead.%f"\n    gpromi'    # deprecated: use gpromi instead (interactive rebase from origin main)
gupv=$'\n    print -Pu2 "%F{yellow}[oh-my-zsh] \'%F{red}gupv%F{yellow}\' is a deprecated alias, using \'%F{green}gprv%F{yellow}\' instead.%f"\n    gprv'            # deprecated: use gprv instead (pull with rebase, verbose)

gwch='git log --patch --abbrev-commit --pretty=medium --raw'                                                                                                        # show commit log with patch, abbreviated hash, medium format, raw diff

gwip='git add -A; git rm $(git ls-files --deleted) 2> /dev/null; git commit --no-verify --no-gpg-sign --message "--wip-- [skip ci]"'                                # work in progress: stage all changes and commit with WIP message

gwipe='git reset --hard && git clean --force -df'                                                                                                                   # wipe all local changes (reset hard and clean untracked files)

gwt='git worktree'                                                                                                                                                  # manage multiple working trees
gwta='git worktree add'                                                                                                                                             # add a new working tree
gwtls='git worktree list'                                                                                                                                           # list all working trees
gwtmv='git worktree move'                                                                                                                                           # move a working tree to a new location
gwtrm='git worktree remove'                                                                                                                                         # remove a working tree

history=omz_history                                                                                                                                                 # oh-my-zsh history function

l='ls -lah'                                                                                                                                                         # list files with details, all files, human-readable sizes
la='ls -lAh'                                                                                                                                                        # list files with details, all files (except . and ..), human-readable sizes
ll='ls -lh'                                                                                                                                                         # list files with details, human-readable sizes
ls='ls --color=tty'                                                                                                                                                 # list files with color output
lsa='ls -lah'                                                                                                                                                       # list files with details, all files, human-readable sizes

md='mkdir -p'                                                                                                                                                       # create directory and parent directories if needed

rd=rmdir                                                                                                                                                            # remove empty directory

which-command=whence                                                                                                                                                # zsh builtin to locate commands (alias for which)
