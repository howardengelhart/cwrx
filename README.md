cwrx
===

Cinema6 API services. Awesome. Totally. Awesome.

Development Quickstart
----------------------

### Requirements ###

 1. Install Node. Currently (6/24/2015) cwrx is known to support Node v0.10; v0.12 may be compatible, but just in case, it may be best to download what our API servers use, [v0.10.24](https://nodejs.org/dist/v0.10.24/).
 
 2. Install our dependencies:
 
   ```bash
   $ npm install
   ```
   
 3. (Optional) Install the pre-commit hook. This lints and unit-tests your code before every commit, so you don't need to wait for Jenkins to tell you that your pull request breaks everything. You may need to manually comment out the lines in `.git/hooks/pre-commit` if you ever need to push up WIP commits which don't pass linting and/or unit tests.
  
   ```bash
   $ grunt install_hook
   ```
   
### Unit Tests ###
   
Unit tests are run with the `grunt unit_tests` command.

`grunt watch` will watch your files and rerun `grunt jshint` and `grunt unit_tests`.

<br>

End-to-End Tests
----------------

cwrx contains end-to-end tests that attempt to cover all outwardly-visible functionality of every API endpoint. Written using jasmine, they send requests to running services, and often manipulate running mongo databases.

The e2e tests are run like this:

```bash
$ grunt e2e_tests:<prefix> --testHost=<host> --dbHost=<dbHost> --cacheHost=<cacheHost>
```

- `prefix` is used to restrict which tests are run. For example, `content` will run all content service tests, while `content.cards` will run only card endpoint tests in the content service. See the filenames in `/test/e2e/`, anything before `.e2e.spec.js` is valid. No prefix runs all tests.
- `testHost` is the host where the services should be running. Defaults to `localhost`
- `dbHost` is the host where mongo should be running. Defaults to `33.33.33.100`.
- `cacheHost` is the host where memcached should be running. Defaults to `localhost`. Not always needed.

The userSvc requires the existance of a system user *sixxy*. The e2e tests will fail if this user does not exist. In order to create it you can run the included *sixxyUser.js* script.

In order to run the services locally, you have a few options:

### Use a Vagrant API machine: ###
Easiest initial setup.

This machine will have the cwrx services, mongo, and memcached all running, similar to our live servers. In this repo, run:

```bash
$ vagrant up
```

(This assumes you have Vagrant, Berkshelf, and VirtualBox installed)

By default, this will start the auth and maint services, and the services will run the latest code from `master`. You can set the `CWRX_APP` environment variable to a comma-separated list of service names, or 'all' for all services, to choose which services are installed, and you can set the `CWRX_DEV_BRANCH` to any ref that exists in the remote repo.

You can also use `scripts/watchit.js` to automatically sync local files to the vagrant machine. This script, run from the guest vagrant box, will watch cwrx lib and bin dirs for changes.  When it finds a file has changed, it loops through a list of services it is managing, copies the changed file to the relevant service, and then restarts the service.  This eliminates the need to push changes via github.

You can run the script yourself, from your dev box using this command line (note this example will restart the ads services when file changes are detected):
```bash
$ ssh -i ~/.vagrant.d/insecure_private_key vagrant@33.33.33.10 'sudo /usr/local/bin/node /vagrant/    scripts/watchit.js ads'
```
To kill ctrl-c and then run this
```bash
$ ssh -i ~/.vagrant.d/insecure_private_key vagrant@33.33.33.10 'sudo killall watchit'
```

Additionally, there are grunt tasks to facilitate this workflow:

**Startup vagrant**

```bash
$ grunt vagrant:up --service=ads
```
This will run vagrant up, setting CWRX_APPS environment variable to `ads` + other services it needs to be running.  Once the vagrant box is up, it will run watchit, passing `ads` as its service.

**Watch vagrant**

```bash
$ grunt vagrant:watch --service=ads
```
This will just run the watchit script

**Stop vagrant**

```bash
$ grunt vagrant:halt
```

**NOTE:** If you are changing the services you are working on, running ```$ vagrant destroy``` before running ```$ grunt vagrant:up --service=ads``` might be prudent.

 
### Use a Vagrant Mongo machine, run services locally: ###
Easier to control/customize services.

This allows you to easily and quickly setup a mongo database while giving you full control over the API services.

The best way to get a mongo machine running is to clone the [c6mongo cookbook](https://bitbucket.org/cinema6/c6mongo) and run `vagrant up` inside it. By default, the created mongo instance will be running at `33.33.33.100:27017` and should have all the users installed that you'll need for the services.

In order to run a service locally, you'll need to setup a few things:
- Config file. See `config/sample.json` for an example; you should copy this into other files and change any instances of 'sample' to your service's name.
- Init script. Similarly, copy `init/sample.sh` into other files and replace all instances of 'sample' to your service's name. Be sure to change the port too: each service needs to run on a different port, and the e2e tests will assume certain services run on certain ports:

 | Service name | Port |
 | ------------ | ---- |
 | accountant   | 4300 |
 | ads          | 3900 |
 | auth         | 3200 |
 | collateral   | 3600 |
 | content      | 3300 |
 | geo          | 4200 |
 | maint        | 4000 |
 | monitor      | 5000 |
 | orgSvc       | 3700 |
 | player       | 6100 |
 | querybot     | 4100 |
 | search       | 3800 |
 | userSvc      | 3500 |
 | vote         | 3400 |

 You should then run the init scripts from the cwrx root like:
 ```bash
 $ ./init/sample.sh restart
 ```

  **Note**: Most services have dependencies on other services, so the
  dependents will need to be started as well when testing:

  | Service    | Dependencies                                    |
  | ---------- | ----------------------------------------------- |
  | accountant | auth, monitor, orgSvc, ads                      |
  | ads        | auth, monitor, accountant, content, orgSvc, geo |
  | auth       | monitor                                         |
  | collateral | auth, monitor                                   |
  | content    | auth, monitor                                   |
  | geo        | auth, monitor                                   |
  | maint      | none                                            |
  | monitor    | maint                                           |
  | orgSvc     | auth, monitor, accountant                       |
  | player     | auth, monitor, content                          |
  | querybot   | auth, monitor                                   |
  | search     | auth, monitor                                   |
  | userSvc    | auth, orgSvc, ads, monitor                      |
  | vote       | auth, monitor, maint                            |

- Secrets file. The path will generally be `~/.<svcName>.secrets.json` and the content should look like this:
 ```json
 {
    "cookieParser": "testsecret",
    "mongoCredentials": {
        "user": "<svcName>",
        "password": "password"
    }
 }
 ```
 Some services may require additional credentials: the search service will require a `googleKey` in this secrets file, for example.

- Version files for each service. These can be easily generated with the
  following command (run once for each service from the cwrx repo,
  replacing "service-name" with the actual name of the service):
  ```bash
  $> git describe --tags --long > bin/service-name.version
  ```
