module.exports = {
    options : {
        stateInterval:   5,
        stateIters:     24,
        sshInterval:     5,
        sshIters:       24
    },
    jenkins1 : {
        startInstances : [
            'api-dev-1',
            'mongo-dev-1'
        ],
        runInstances : [
            {
                userDataFile : 'staging.sh',
                tags : [
                    {
                        Key: 'Name',
                        Value: 'jenkins1-apiServer'
                    },
                    {
                        Key: 'Owner',
                        Value: 'jenkins'
                    }
                ],
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
        ]
    }
};
