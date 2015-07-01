sample="node ./bin/sample.js"
pidfile="./pids/sample.pid"
CONF_FILE="./config/sample.json"

start() {
    echo $"Starting sample: "
    $sample -d -p 3300 -c $CONF_FILE
    retval=$?
    return $retval
}

stop() {
    echo $"Stopping sample: "
    if [ -e $pidfile ]; then
        for line in $(cat $pidfile); do
            kill -15 $line
        done
        sleep 0.5
        if [ -r $pidfile ]; then rm $pidfile; fi
    fi
    retval=$?
    return $retval
}

restart() {
    configtest || return 6
    stop
    start
}

configtest() {
    $sample -c $CONF_FILE --show-config
}

case "$1" in
    start)
        $1
        ;;
    stop)
        $1
        ;;
    restart)
        $1
        ;;
    *)
        echo $"Usage: $0 {start|stop|restart}"
        exit 2
esac
