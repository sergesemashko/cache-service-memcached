var namespace = 'cache-module:memcached';
var debug = require('debug-levels')(namespace);
var Memcached = require('memcached');
var noop = function () {
};

/**
 * MemcachedCacheModule constructor
 * @constructor
 *
 * @param locations {string|array|object} - Memcached servers location(s). @see https://www.npmjs.com/package/memcached#server-locations
 * @param options {object: {
 *    verbose {boolean} Default: false - enables debug logging
 *    defaultLifetime {number} Default: 90 - default lifetime value in seconds
 *    backgroundRefreshIntervalCheck {boolean} Default: `true` - enables `backgroundRefreshInterval` validation. **Background refresh only**
 *    backgroundRefreshInterval {number} Default: 60000 - frequency of checking items for background refresh. This value should be less than `backgroundRefreshMinTtl`. **Background refresh only**
 *    backgroundRefreshMinTtl {number} Default: 70000 - determines a check time for background refresh. Items that expire in less than this value, will be re-fetched during background refresh cycle. **Background refresh only**
 *    memcachedOptions: {
 *      @see rest of the options in memcached npm module reference https://www.npmjs.com/package/memcached#options
 *    }
 * }} - cache module memcached configuration
 */
function MemcachedCacheModule (locations, options) {
  options = options || {};
  if (!(this instanceof MemcachedCacheModule)) {
    return new MemcachedCacheModule(locations, options);
  }

  this.type = 'memcached-cache-module';
  this.storage = 'memcached';
  if (options.verbose) {
    require('debug').enable(namespace);
  }
  this._backgroundRefreshEnabled = false;
  this._defaultLifetime = options.defaultLifetime || 90;
  this._refreshKeys = {};
  this._backgroundRefreshIntervalCheck = (typeof options.backgroundRefreshIntervalCheck === 'boolean') ? options.backgroundRefreshIntervalCheck : true;
  this._backgroundRefreshInterval = options.backgroundRefreshInterval || 60000;
  this._backgroundRefreshMinTtl = options.backgroundRefreshMinTtl || 70000;

  var memcachedOptions = options.memcachedOptions || {};

  debug.info('Connecting to memcached: \n%O', locations);
  this.memcachedClient = new Memcached(locations, memcachedOptions);
  this.memcachedClient.on('failure', function (details) {
    var msg = 'Memcached server ' + details.server + ' went down due to: \n' + details.messages.join();
    throw new Error(msg);
  });
  this.memcachedClient.on('reconnecting', function (details) {
    debug.warn(
      'Total downtime caused by server ' + details.server + ': ' + details.totalDownTime + 'ms'
    );
  });
  this.memcachedClient.on('issue', function (details) {
    debug.warn(
      'Total downtime caused by server ' + details.server + ': ' + details.totalDownTime + 'ms'
    );
  });
  this.memcachedClient.on('reconnect', function (details) {
    debug.warn(
      'Total downtime caused by server ' + details.server + ': ' + details.totalDownTime + 'ms'
    );
  });
  this.memcachedClient.on('remove', function (details) {
    debug.warn(
      'Total downtime caused by server ' + details.server + ': ' + details.totalDownTime + 'ms'
    );
  });
}

MemcachedCacheModule.prototype.add = function (key, value, lifetime, cb) {
  cb = cb || noop;
  lifetime = lifetime || this._defaultLifetime;
  debug.verbose('add() called with \n    key=%s\n    lifetime=%d seconds', key, lifetime);
  this.memcachedClient.add(key, value, lifetime, function (err, result) {
    if (err) {
      debug.error('add(): Unable to store ' + key + ' to memcached, err:', err);
    } else {
      debug.verbose('add():success key=%s', key);
    }
    cb(err, result);
  });
};

MemcachedCacheModule.prototype.get = function (key, cb, cleanKey) {
  var cacheKey = cleanKey || key;
  debug.verbose('get() called with key=%s', cacheKey);
  this.memcachedClient.get(cacheKey, function (err, result) {
    if (err) {
      debug.error('Unable to get key=' + cacheKey + ' from memcached, err:', err);
    }
    if (result) {
      debug.verbose('get():hit key=%s', cacheKey);
      return cb(err, result);
    }
    debug.verbose('get():miss key=%s', cacheKey);
    cb(err, null);
  });
};

MemcachedCacheModule.prototype.mget = function (keys, cb, index) {
  debug.verbose('mget() called with keys=%O', keys);
  this.memcachedClient.getMulti(keys, function (err, response) {
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      var key = keys[keyIndex];
      if (response.hasOwnProperty(key)) {
        try {
          response[key] = JSON.parse(response[key]);
        } catch (err) {
          debug.error('mget(): Error parsing JSON for key=%s, \nerr: %s', key, err);
        }
      } else {
        response[key] = null;
      }
    }
    cb(err, response, index);
  });
};

MemcachedCacheModule.prototype.set = function () {
  var _this = this;
  var key = arguments[0];
  var value = arguments[1];
  var lifetime = arguments[2] || this._defaultLifetime;
  var refreshCb = (arguments.length === 5) ? arguments[3] : null;
  var cb = arguments[arguments.length - 1];
  if (typeof cb !== 'function') {
    cb = noop;
  }
  debug.verbose('set() called with key=%s, lifetime=%ss', key, lifetime);
  this.memcachedClient.set(key, value, lifetime, function (err, result) {
    if (err) {
      debug.error('set(): Unable to store %s to memcached, \nerr: %s', key, err);
    } else {
      debug.verbose('set():success key=%s', key);
      if (refreshCb) {
        var expirationDate = (lifetime * 1000) + Date.now();
        _this._refreshKeys[key] = {
          expirationDate: expirationDate,
          lifeSpan: lifetime,
          refreshCb: refreshCb
        };
        _this._backgroundRefreshInit();
      }
    }

    cb(err, result);
  });
};

MemcachedCacheModule.prototype.mset = function (obj, lifetime, cb) {
  var _this = this;
  var promises = [];
  cb = cb || noop;
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      var tempExpiration = lifetime || this._defaultLifetime;
      var value = obj[key];
      if (typeof value === 'object' && value.cacheValue) {
        tempExpiration = value.lifetime || tempExpiration;
        value = value.cacheValue;
      }
      try {
        value = JSON.stringify(value);
      } catch (err) {
        debug.error('mset(): Error converting value to string for key=%s, err: %s', key, err);
      }
      promises.push((function (key, value, tempExpiration) {
        return new Promise(function (resolve, reject) {
          return _this.set(key, value, tempExpiration, function (err, result) {
            if (err) {
              return reject(err);
            }
            return resolve(err, result);
          });
        });
      })(key, value, tempExpiration)); // reference local vars instead of mutable ones.
    }
  }
  Promise.all(promises)
    .then(function (results) {
      cb(null, results);
    })
    .catch(function (error) {
      cb(error);
    });
};

MemcachedCacheModule.prototype.del = function (key, cb) {
  var _this = this;
  cb = cb || noop;
  debug.verbose('del() called with key=%s', key);
  if (typeof key === 'string') {
    this.memcachedClient.del(key, cb);
  } else if (Array.isArray(key)) {
    Promise.all(key.map(function (key) {
      return new Promise(function (resolve, reject) {
        return _this.del(key, function (err, result) {
          if (err) {
            return reject(err);
          }
          return resolve(err, result);
        });
      });
    }))
      .then(function (results) {
        cb(null, results);
      })
      .catch(function (error) {
        cb(error);
      });
  } else {
    cb(new Error('`key` type should be either String or Array'));
  }
};

MemcachedCacheModule.prototype.flush = function (cb) {
  debug.verbose('flush() called');
  if (this._refreshInterval) {
    this._backgroundRefreshEnabled = false;
    clearTimeout(this._refreshInterval);
  }
  this.memcachedClient.flush(cb || noop);
};

/**
 * Handle the refresh callback from the consumer, save the data to memcached.
 *
 * @param {string} key The key used to save.
 * @param {Object} data refresh keys data.
 * @param {Error|null} err consumer callback failure.
 * @param {*} response The consumer response.
 */
MemcachedCacheModule.prototype._handleRefreshResponse = function (key, data, err, response) {
  if (!err) {
    this.set(key, response, data.lifeSpan, data.refresh, noop);
  }
};

/**
 * Refreshes all keys that were set with a refresh function
 */
MemcachedCacheModule.prototype._backgroundRefresh = function () {
  var keys = Object.keys(this._refreshKeys);
  var now = Date.now();
  keys.forEach(function (key) {
    var cachedItemMetadata = this._refreshKeys[key];

    if (cachedItemMetadata.expirationDate - now < this._backgroundRefreshMinTtl) {
      cachedItemMetadata.refreshCb(
        key,
        this._handleRefreshResponse.bind(this, key, cachedItemMetadata)
      );
    }
  }, this);
};

/**
 * Initialize background refresh
 */
MemcachedCacheModule.prototype._backgroundRefreshInit = function () {
  if (!this._backgroundRefreshEnabled) {
    debug('Background refresh is enabled with following parameters: \n' +
      '    backgroundRefreshIntervalCheck=%d \n' +
      '    backgroundRefreshMinTtl=%d \n' +
      '    backgroundRefreshInterval=%d',
      this._backgroundRefreshIntervalCheck,
      this._backgroundRefreshMinTtl,
      this._backgroundRefreshInterval
    );
    this._backgroundRefreshEnabled = true;
    if (this._backgroundRefreshIntervalCheck) {
      if (this._backgroundRefreshInterval > this._backgroundRefreshMinTtl) {
        throw new Error('BACKGROUND_REFRESH_INTERVAL_EXCEPTION', 'backgroundRefreshInterval cannot be greater than backgroundRefreshMinTtl.');
      }
    }
    this._refreshInterval = setInterval(
      this._backgroundRefresh.bind(this),
      this._backgroundRefreshInterval
    );
  }
};

module.exports = MemcachedCacheModule;
