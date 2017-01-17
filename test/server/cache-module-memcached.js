var expect = require('expect');
var memcachedMock = require('memcached-mock');
var proxyquire = require('proxyquire');
var MemcachedCacheModule = proxyquire('../../cache-module-memcached', { memcached: memcachedMock });
var memcached = new MemcachedCacheModule();

var key = 'key';
var value = 'value';

function noop () {}
/* eslint-disable handle-callback-err */
describe('memcachedCacheModule Tests', function () {
  beforeEach(function (done) {
    memcached.flush(function () {
      done();
    });
  });
  it('Getting absent key should return null', function (done) {
    memcached.get(key, function (err, result) {
      expect(result).toBe(null);
      done();
    });
  });
  it('Setting, then getting key should return a value', function (done) {
    memcached.set(key, value, 1, function () {
      memcached.get(key, function (err, result) {
        expect(result).toBe(value);
        done();
      });
    });
  });
  it('Setting, then deleting, then getting key should return null', function (done) {
    memcached.set(key, value, 1, function () {
      memcached.del(key, function () {
        memcached.get(key, function (err, result) {
          expect(result).toBe(null);
          done();
        });
      });
    });
  });
  it('Setting several keys, then calling .flush() should remove all keys', function (done) {
    memcached.set(key, value, 1, function () {
      memcached.set('key2', 'value2', 1, function () {
        memcached.set('key3', 'value3', 1, function () {
          memcached.mget([key, 'key2', 'key3'], function (err, response) {
            expect(response.key).toBe('value');
            expect(response.key2).toBe('value2');
            expect(response.key3).toBe('value3');
            memcached.flush(function () {
              memcached.mget([key, 'key2', 'key3'], function (err, response) {
                expect(response.key).toBe(null);
                expect(response.key2).toBe(null);
                expect(response.key3).toBe(null);
                done();
              });
            });
          });
        });
      });
    });
  });
  it('Setting several keys, then calling .mget() should retrieve all keys', function (done) {
    memcached.set(key, value, 1, function () {
      memcached.set('key2', 'value2', 1, function () {
        memcached.set('key3', 'value3', 1, function () {
          memcached.mget([key, 'key2', 'key3', 'key4'], function (err, response) {
            expect(response[key]).toBe('value');
            expect(response['key2']).toBe('value2');
            expect(response['key3']).toBe('value3');
            expect(response['key4']).toBe(null);
            done();
          });
        });
      });
    });
  });
  it('Setting several keys via .mset() then calling .mget() should retrieve all keys', function (done) {
    memcached.mset({key: value, 'key2': 'value2', 'key3': 'value3'}, null, function (err, replies) {
      memcached.mget([key, 'key2', 'key3', 'key4'], function (err, response) {
        expect(response.key).toBe('value');
        expect(response.key2).toBe('value2');
        expect(response.key3).toBe('value3');
        expect(response.key4).toBe(null);
        done();
      });
    });
  });
  it('Using background refresh should activate for a key that already exists', function (done) {
    this.timeout(5000);
    var refreshValue = 'refreshValue';
    var refresh = function (key, cb) {
      cb(null, refreshValue);
    };
    memcached._backgroundRefreshInterval = 1;
    memcached.set(key, value, 5, function () {
      memcached.set(key, value, 1, refresh, function (err, result) {
        setTimeout(function () {
          memcached.get(key, function (err, response) {
            expect(response).toBe(refreshValue);
            done();
          });
        }, 10);
      });
    });
  });
  it('Using background refresh should activate for a vacant key and reset it when nearly expired', function (done) {
    this.timeout(5000);
    var refresh = function (key, cb) {
      cb(null, 1);
    };
    memcached._backgroundRefreshInterval = 1;
    memcached.set(key, value, 1, refresh, function (err, result) {
      setTimeout(function () {
        memcached.get(key, function (err, response) {
          expect(response).toBe(1);
          done();
        });
      }, 10);
    });
  });
  it('Using background refresh should work for multiple keys', function (done) {
    this.timeout(5000);
    memcached._backgroundRefreshInterval = 1;
    var refresh = function (key, cb) {
      switch (key) {
        case 'one':
          setTimeout(function () {
            cb(null, 1);
          }, 1);
          break;
        case 'two':
          setTimeout(function () {
            cb(null, 2);
          }, 1);
          break;
      }
    };

    memcached.set('one', value, 1, refresh, noop);
    memcached.set('two', value, 1, refresh, noop);

    setTimeout(function () {
      var results = [];
      function examineResults () {
        results.forEach(function (result) {
          if (result.key === 'one') {
            expect(result.response).toBe(1);
          } else {
            expect(result.response).toBe(2);
          }
        });

        done();
      }
      memcached.get('one', function (err, response) {
        results.push({key: 'one', response: response});
        if (results.length === 2) {
          examineResults();
        }
      });
      memcached.get('two', function (err, response) {
        results.push({key: 'two', response: response});
        if (results.length === 2) {
          examineResults();
        }
      });
    }, 10);
  });
});
