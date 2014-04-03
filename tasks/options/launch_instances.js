module.exports = {
    options : {
        stateInterval :  15,
        stateTimeout  : 180,
        sshInterval   :  15,
        sshTimeout    : 120,
        httpInterval  :  30,
        httpTimeout   : 600,
        owner         : 'jenkins',
        ec2_templates : {
            'apiServer' : {
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
    },
    vote : {
        startInstances : [ 'mongo-dev-1' ],
        runInstances   : [ { name: 'test-vote', params: 'apiServer' } ],
        checkHttp : [
            {
                host    : 'test-vote',
                iface   : 'public',
                path    : '/api/vote/meta'
            }
        ],
        checkSsh : [ { host : 'mongo-dev-1' } ]
    },
    auth : {
        startInstances : [ 'mongo-dev-1' ],
        runInstances   : [ { name: 'test-auth', params: 'apiServer' } ],
        checkHttp : [
            {
                host    : 'test-auth',
                iface   : 'public',
                path    : '/api/auth/meta'
            }
        ],
        checkSsh : [ { host : 'mongo-dev-1' } ]
    }
};
