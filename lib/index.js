var path = require('path')
  , util = require('util');

// Directory structure:
//   https://github.com/capistrano/capistrano/wiki/2.x-From-The-Beginning
//
//   https://github.com/seattlerb/vlad/blob/master/lib/vlad/core.rb
//   https://github.com/seattlerb/vlad/blob/master/lib/vlad/subversion.rb
//   https://github.com/jbarnette/vlad-git/blob/master/lib/vlad/git.rb

module.exports = function(options) {
  var now = new Date();
  var ts = timestamp(now);

  var name = options.name;
  var repository = options.repo || options.repository;
  var revision = options.revision || 'origin/master';
  
  var deployDir = options.deployDir || path.join('/opt', name);
  var repoDir = path.join(deployDir, 'repo');
  var releasesDir = path.join(deployDir, 'releases');
  var latestRel = path.join(releasesDir, ts);
  
  
  return function(sys, conn, done) {
    mkdirs();
    
    function mkdirs() {
      var command = util.format('mkdir -p "%s" "%s"', repoDir, releasesDir);
    
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to create deployment directory structure')); }
          return update();
        });
      });
    }
    
    function update() {
      var command = util.format('cd "%s" && git log -n 1 --oneline', repoDir);
      
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return clone(); }
          return fetch();
        });
      });
    }
    
    function clone() {
      // -q, --quiet
      // -n, --no-checkout
      var command = util.format('git clone -q -n "%s" "%s"', repository, repoDir);
      
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to clone Git repository')); }
          return extract();
        });
      });
    }
    
    function fetch() {
      // TODO: Verify that the specified repository is a remote.
      var command = util.format('cd "%s" && git fetch --all', repoDir);
      
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to fetch Git repository')); }
          return extract();
        });
      });
    }
    
    function extract() {
      var command = util.format('mkdir -p "%s" && cd "%s" && git archive --format=tar %s | (cd "%s" && tar xf -)',
                                  latestRel,
                                  repoDir,
                                  revision,
                                  latestRel);
      
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to extract revision from Git repository')); }
          return symlink();
        });
      });
    }
    
    function symlink() {
      var target = path.join('releases', ts);
      var command = util.format('cd "%s" && rm -f %s && ln -s %s %s',
                                  deployDir,
                                  'current',
                                  target,
                                  'current');
      
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to symlink current release')); }
          return log();
        });
      });
    }
    
    function log() {
      var date_cmd = 'date -u +"%Y-%m-%dT%H:%M:%SZ"';
      var revparse_cmd = util.format('git rev-parse %s', revision);
    
      var command = util.format('cd "%s" && echo `%s` $USER %s %s `%s` %s >> %s',
                      repoDir,
                      date_cmd,
                      repository,
                      revision,
                      revparse_cmd,
                      path.basename(latestRel),
                      path.join(deployDir, 'revisions.log'));
        
      conn.exec(command, function(err, cmd) {
        if (err) { return done(err); }
        
        cmd.on('exit', function(code, signal) {
          if (code !== 0) { return done(new Error('Failed to write to log file')); }
          return cleanup();
        });
      });
    }
    
    function cleanup() {
      list();
      
      function list() {
        var command = util.format('ls -1At "%s"', releasesDir);
        
        conn.exec(command, function(err, cmd) {
          if (err) { return done(err); }
          
          var output = '';
          
          cmd.on('data', function(data) {
            output += data;
          });
          cmd.on('exit', function(code, signal) {
            if (code !== 0) { return done(new Error('Failed to list contents of releases directory')); }
            
            var entries = output.split('\n').filter(function(el) {
              return el.length > 0;
            });
            return remove(entries);
          });
        });
      }
      
      function remove(entries) {
        (function iter(i, err) {
          if (err) { return done(err); }
          
          var entry = entries[i];
          if (!entry) { return done(); } // done
          
          
          var command = util.format('rm -rf "%s"', path.join(releasesDir, entry));
        
          conn.exec(command, function(err, cmd) {
            if (err) { return done(err); }
            
            cmd.on('exit', function(code, signal) {
              if (code !== 0) { return done(new Error('Failed to remove old release directory')); }
              return iter(i + 1);
            });
          });
        })(5);
      }
    }
  }
}


function timestamp(d) {
  function pad(n) { return n < 10 ? '0' + n : n.toString() }
  return d.getUTCFullYear()
    + pad(d.getUTCMonth() + 1)
    + pad(d.getUTCDate())
    + pad(d.getUTCHours())
    + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds())
}
