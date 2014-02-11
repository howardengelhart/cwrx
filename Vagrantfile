# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  # All Vagrant configuration is done here. The most common configuration
  # options are documented and commented below. For a complete reference,
  # please see the online documentation at vagrantup.com.

  config.vm.hostname = "cwrx-development"

  # Every Vagrant virtual environment requires a box to build off of.
  if ENV['USER'] == 'evan'
    config.vm.box = "CentOS-6.4_i386"
  else
    config.vm.box = "Berkshelf-CentOS-6.3-x86_64-minimal"
  end

  # The url from where the 'config.vm.box' box will be fetched if it
  # doesn't already exist on the user's system.
  if ENV['USER'] == 'evan'
    config.vm.box_url = "http://developer.nrel.gov/downloads/vagrant-boxes/CentOS-6.4-i386-v20130731.box"
  else
    config.vm.box_url = "https://dl.dropbox.com/u/31081437/Berkshelf-CentOS-6.3-x86_64-minimal.box"
  end

  config.vm.network :private_network, ip: "33.33.33.10"

  config.vm.boot_timeout = 120
  config.omnibus.chef_version = :latest
  config.berkshelf.enabled = true

  config.vm.provision :chef_solo do |chef|
    chef.data_bags_path = "#{ENV['CHEF_REPO']}/data_bags"
    chef.encrypted_data_bag_secret_key_path = "#{ENV['HOME']}/.chef/c6data.pem"
    chef.json = {
        :maint => {
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH']}"
            },
            :cfg => {
                :loglevel => "trace"
            }
        }
    }

    if ENV['CWRX_APP'] == 'maint'
        chef.run_list = [ "recipe[maint]" ]
    end

    if ENV['CWRX_APP'] == 'dub'
        chef.json[:dub] = {
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH']}",
            },
            :cfg => {
                :loglevel => "trace"
            }
        }
        
        chef.run_list = [
            "recipe[dub::default]"
        ]
    end
    
    if ENV['CWRX_APP'] == 'vote'
        chef.json[:vote] = {
            :source => {
                :branch => "#{ENV['CWRX_DEV_BRANCH']}",
            },
            :cfg => {
                :loglevel => "trace"
            },
            :secrets => {
                :cookieParser => "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ,
                :mongoCredentials => {
                    :user => "vote",
                    :password => "password"
                }
            }
        }
    
        chef.run_list = [
            "recipe[vote]",
            "recipe[maint]"
        ]
    end

  end
end
