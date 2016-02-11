# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  # All Vagrant configuration is done here. The most common configuration
  # options are documented and commented below. For a complete reference,
  # please see the online documentation at vagrantup.com.

  config.vm.hostname = "cwrx-development"

  # Every Vagrant virtual environment requires a box to build off of.
  config.vm.box = "Reelcontent-CentOS-6.3-x86_64-1.0.0"

  # The url from where the 'config.vm.box' box will be fetched if it
  # doesn't already exist on the user's system.
  config.vm.box_url = "https://s3.amazonaws.com/c6.dev/VagrantBoxes/Reelcontent-CentOS-6.3-x86_64-1.0.0.box"

  config.vm.network :private_network, ip: "33.33.33.10"
  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--natdnshostresolver1", "on"]
  end

  config.vm.boot_timeout = 180
  config.omnibus.chef_version = :latest
  config.berkshelf.enabled = true

  config.ssh.insert_key = false

  # This Vagrantfile will by default start up the maint + auth services. You can provide a CSV list
  # of service names in the CWRX_APP env variable, or 'all' to start all services.

  config.vm.provision :chef_solo do |chef|
    chef.data_bags_path = "#{ENV['CHEF_REPO']}/data_bags"
    chef.encrypted_data_bag_secret_key_path = "#{ENV['HOME']}/.chef/c6data.pem"
    chef.environments_path = "./chef/environments"
    chef.environment = "Development"
    chef.json = {
        :c6env => {
            :npm => {
                :registry => 'http://deployer1.corp.cinema6.com:4873'
            }
        },
        :c6mongo => {
            :indexes => {
                "geoDb" => {
                    "zipcodes" => [
                        { "field" => "zipcode", "unique" => true },
                        { "field" => "loc", "type" => "2dsphere" }
                    ]
                },
                "c6Journal" => {
                    "audit" => [
                        { "field" => "created", "type" => "descending" }
                    ]
                }
            },
            :users => {
                :ids => ["evan", "howard", "e2eTests", "content", "collateral", "auth", "userSvc", "orgSvc", "vote", "search", "deepthought", "ads", "querybot", "geo"]
            },
            "cappedColls" => [
                {
                    "name"  => "audit",
                    "db"    => "c6Journal",
                    "size"  => 10000
                }
            ],
            :cfg => {
                :auth => true,
                :smallfiles => true
            }
        },
        :auth => {
            :awsAuth => JSON.parse(File.read("#{ENV['HOME']}/.aws.json")),
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH'] || 'master'}"
            },
            :mongo => {
                :c6Db => { :host => "127.0.0.1" },
                :c6Journal => { :host => "127.0.0.1" }
            },
            :cfg => {
                :loglevel => "trace",
                :sessions => { :mongo => { :host => "127.0.0.1" } },
            }
        },
        :maint => {
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH'] || 'master'}"
            },
            :cfg => {
                :loglevel => "trace"
            }
        }
    }
    chef.run_list = [
        "recipe[c6env::memcached]",
        "recipe[c6mongo]",
        "recipe[auth]",
        "recipe[maint]"
    ]
    
    svcs = ['ads', 'collateral', 'content', 'geo', 'monitor', 'orgSvc', 'player', 'search', 'userSvc', 'vote', 'querybot', 'c6postgres', 'c6postgres::admin']
    
    if ENV['CWRX_APP'] == 'all'
        chosen = svcs
    else
        chosen = (ENV['CWRX_APP'] || '').split(',').select { |svc| svcs.include?(svc) }
    end
    
    chosen.each do |svc|
        if svc === "player"
            chef.run_list.push("recipe[player::mock_player]")
        end

        chef.run_list.push("recipe[#{svc}]")
        chef.json[svc] = {
            :awsAuth => JSON.parse(File.read("#{ENV['HOME']}/.aws.json")),
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH'] || 'master'}"
            },
            :mongo => {
                :c6Db => { :host => "127.0.0.1" },
                :c6Journal => { :host => "127.0.0.1" }
            },
            :cfg => {
                :loglevel => "trace",
                :sessions => { :mongo => { :host => "127.0.0.1" } }
            }
        }

        if svc == 'vote'
            chef.json[svc][:mongo][:voteDb] = { :host => "127.0.0.1" }
        end
        
        if svc == 'geo'
            chef.json[svc][:config] = {
                "sessions" => {
                    "mongo" => {
                        "host" => "127.0.0.1"
                    }
                },
                "mongo" => {
                    "c6Db" => {
                        "host" => "127.0.0.1"
                    },
                    "c6Journal" => {
                        "host" => "127.0.0.1"
                    },
                    "geoDb" => {
                        "host" => "127.0.0.1"
                    }
                }
            }
        end

        if svc == 'c6postgres'
            chef.json[svc][:pg_hba] = [
                "local all all md5",
                "host all all 127.0.0.1/8 md5",
                "host all all 33.33.33.0/24 md5"
            ]
        end

        if svc == 'querybot'
            chef.json[svc][:config] = {
                "log" => {
                    "logLevel" => "info",
                    "logDir"   => "/opt/sixxy/logs",
                    "logName"  => "querybot.log",
                    "media"    => [ { "type" => "file" } ]
                },
                "caches" => { "run" => "/opt/sixxy/run/" },
                "sessions" => {
                    "key"     => "c6Auth",
                    "maxAge"  => 14,  # days
                    "secure"  => false,
                    "mongo" => { "host" => "127.0.0.1", "port" => 27017 }
                },
                "mongo" => {
                    "c6Db" => { "host" => "127.0.0.1", "port" => 27017 }
                },
                "pg" => {
                    "defaults" => {
                        "database"  => "campfire_cwrx",
                        "host"      => "localhost",
                        "user"      => "sixxy"
                    }
                },
                "cache" => {
                    "servers" => [],
                    "timeouts" => {
                        "read" => 500,
                        "write" => 2000,
                        "stats" => 2000
                    }
                },
                "pubsub" => {
                    "cacheCfg" => {
                        "port" => 21211,
                        "isPublisher" => false,
                        "opts" => {
                            "reconnect" => true,
                            "reconnectDelay" => 5000,
                            "pingDelay" => 5000
                        }
                    }
                }
            }
        end
    end
  end
end
