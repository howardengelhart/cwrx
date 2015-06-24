cwrx
===

Cinema6 API services. Awesome. Totally. Awesome.

Development Quickstart
----------------------

### Requirements ###

 1. Install Node. Currently (6/24/2015) cwrx is known to support Node v0.10; v0.12 may be compatible, but just in case, it may be best to download what our API servers use, [v0.10.24](https://nodejs.org/dist/v0.10.24/).
 
 2. Install `jasmine-node`:
   
   ```bash
   $ npm install jasmine-node -g
   ```
   
 3. Install our dependencies:
 
   ```bash
   $ npm install
   ```
   
 4. (Optional) Install the pre-commit hook. This lints and unit-tests your code before every commit, so you don't need to wait for Jenkins to tell you that your pull request breaks everything.
  
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

- `<prefix>` is used to restrict which tests are run. For example, `content` will run all content service tests, while `content.cards` will run only card endpoint tests in the content service. See the filenames in `/test/e2e/`, anything before `.e2e.spec.js` is valid. No prefix runs all tests.
- `testHost` is the host where the services should be running. Defaults to `localhost`
- `dbHost` is the host where mongo should be running. Defaults to `33.33.33.100`.
- `cacheHost` is the host where memcached should be running. Defaults to `localhost`. Not always needed.


In order to run the services locally, you have a few options:

 1. **Use a Vagrant API machine**: Easiest setup, hardest to use for active development.
   
   This machine will have the cwrx services, mongo, and memcached all running, similar to our live servers. In this repo, run:
  
   ```bash
   $ vagrant up
   ```
   
   (This assumes you have Vagrant, Berkshelf, and VirtualBox installed)
   
   By default, this will start the auth and maint services, and the services will run the latest code from `master`. You can set the `CWRX_APP` environment variable to a comma-separated list of service names, or 'all' for all services, to choose which services are installed, and you can set the `CWRX_DEV_BRANCH` to any ref that exists in the remote repo.
 
 2. **Use a Vagrant Mongo machine, run services locally**: 
