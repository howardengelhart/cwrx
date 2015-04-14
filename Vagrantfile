# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  # All Vagrant configuration is done here. The most common configuration
  # options are documented and commented below. For a complete reference,
  # please see the online documentation at vagrantup.com.

  config.vm.hostname = "cwrx-development"

  # Every Vagrant virtual environment requires a box to build off of.
  config.vm.box = "Berkshelf-CentOS-6.3-x86_64-minimal"

  # The url from where the 'config.vm.box' box will be fetched if it
  # doesn't already exist on the user's system.
  config.vm.box_url = "https://s3.amazonaws.com/c6.dev/VagrantBoxes/Berkshelf-CentOS-6.3-x86_64-minimal.box"

  config.vm.network :private_network, ip: "33.33.33.10"

  config.vm.boot_timeout = 180
  config.omnibus.chef_version = :latest
  config.berkshelf.enabled = true


  # This Vagrantfile will by default start up the maint + auth services. You can provide a CSV list
  # of service names in the CWRX_APP env variable, or 'all' to start all services.

  config.vm.provision :chef_solo do |chef|
    chef.data_bags_path = "#{ENV['CHEF_REPO']}/data_bags"
    chef.encrypted_data_bag_secret_key_path = "#{ENV['HOME']}/.chef/c6data.pem"
    chef.environments_path = "./chef/environments"
    chef.environment = "Development"
    chef.json = {
        :c6mongo => {
            :users => {
                :ids => ["evan", "howard", "e2eTests", "content", "collateral", "auth", "userSvc", "orgSvc", "vote", "siteSvc", "search", "deepthought", "ads"]
            },
            "cappedColls" => [
                {
                    "name"  => "audit",
                    "db"    => "c6Journal",
                    "size"  => 10000
                }
            ],
            :cfg => {
                :auth => true
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
        "recipe[c6mongo]",
        "recipe[auth]",
        "recipe[maint]"
    ]
    
    svcs = ['ads', 'collateral', 'content', 'monitor', 'orgSvc', 'search', 'userSvc', 'vote']
    
    if ENV['CWRX_APP'] == 'all'
        chosen = svcs
    else
        chosen = (ENV['CWRX_APP'] || '').split(',').select { |svc| svcs.include?(svc) }
    end
    
    chosen.each do |svc|
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
    end
  end
end
