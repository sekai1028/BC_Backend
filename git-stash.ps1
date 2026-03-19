# Run git stash using temp index (fixes "could not write index" when .git is restricted)
$env:GIT_INDEX_FILE = "$env:TEMP\git-index-backend"
git stash @args
