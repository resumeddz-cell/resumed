#!/bin/sh
exec su postgres -c "psql -h /tmp -p 54329 -d resumed -v ON_ERROR_STOP=1 -q $*"
