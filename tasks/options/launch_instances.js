module.exports = {
    options : {
        stateInterval:   5,
        stateIters:     24,
        sshInterval:     5,
        sshIters:       24,
        httpInterval:    5,
        httpIters:      24,
        owner:          'jenkins'
    },
    jenkins1 : {
        startInstances : [
            'api-dev-1',
            'mongo-dev-1'
        ],
        runInstances : [
            {
                name : 'jenkins1',
                userDataFile: 'userdata_vote.sh',
                params : {
                    ImageId             : 'ami-1d9d9474',
                    IamInstanceProfile  : {
                        Name: 'apiServer'
                    },
                    MaxCount : 1,
                    MinCount : 1,
                    InstanceInitiatedShutdownBehavior : 'terminate',
                    InstanceType    : 'm1.small',
                    KeyName         : 'howardkey',
                    NetworkInterfaces : [
                        {
                            DeviceIndex: 0,
                            AssociatePublicIpAddress : true,
                            SubnetId : 'subnet-d41d44b5',
                            Groups : [ 'sg-8f9483ed' ]
                        }
                    ]
                }
            }
        ],
        checkHttp : [
            {
                host    : 'jenkins1',
                iface   : 'public',
                path    : '/api/vote/meta'
            }
        ]
    }
};
