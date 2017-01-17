# Cache service Memcached

![](https://travis-ci.org/sergesemashko/cache-service-memcached.svg?branch=master)

* A [memcached](https://www.npmjs.com/package/memcached) plugin for [cache-service](https://github.com/jpodwys/cache-service)

> This module is highly inspired by [cache-service-redis](https://github.com/jpodwys/cache-service-redis)

#### Features

* Background refresh
* Cache objects-automatic serialization/deserialization of values
* Built-in logging using [debug-levels](https://www.npmjs.com/package/debug-levels).
* Compatible with `cache-service` and `superagent-cache`
* `.mset()` allows you to set expirations on a per key, per function call, and/or per `cache-service-memcached` instance basis.

# Usage

Require and instantiate
```javascript
//Require superagent and the cache module I want
var superagent = require('superagent');
var CacheServiceMemcached = require('cache-service-memcached');
var memcachedCache = new CacheServiceMemcached('127.0.0.1:11211');
var defaults = {cacheWhenEmpty: false, expiration: 900};

//Patch my superagent instance and pass in my memcached cache
require('superagent-cache')(superagent, memcachedCache, defaults);
```

Cache!
```javascript
var lifetime = 300; // 5 minutes
memcachedCache.set('key', 'value', lifetime);
```

# Cache Module Configuration Options

`cache-service-memcached`'s constructor takes an optional config object with any number of the following properties:

## defaultLifetime

The expiration to include when executing cache set commands. Can be overridden via `.set()`'s optional expiraiton param.

* type: int
* default: 90
* measure: seconds

## memcachedOptions

The object that is passed to [memcached](https://www.npmjs.com/package/memcached) as 2nd parameter. [Memcached client options](https://www.npmjs.com/package/memcached#options)

* type: object

#### Example

```javascript
var options = {
  memcachedOptions: {
    maxKeySize: 50,
    maxValue: 20000000
  }
}
```

## backgroundRefreshInterval

How frequently should all background refresh-enabled keys be scanned to determine whether they should be refreshed. For a more thorough explanation on `background refresh`, see the [Using Background Refresh](#using-background-refresh) section.

* type: int
* default: 60000
* measure: milliseconds

## backgroundRefreshMinTtl

The maximum ttl a scanned background refresh-enabled key can have without triggering a refresh. This number should always be greater than `backgroundRefreshInterval`.

* type: int
* default: 70000
* measure: milliseconds

## backgroundRefreshIntervalCheck

Whether to throw an exception if `backgroundRefreshInterval` is greater than `backgroundRefreshMinTtl`. Setting this property to false is highly discouraged.

* type: boolean
* default: true

# API

Although this is a memcached wrapper, its API differs in some small cases from memcached's own API both because the memcached API is sometimes dumb and because all `cache-service`-compatible cache modules match [`cache-service`'s API](https://github.com/jpodwys/cache-service#api).

## .get(key, callback (err, response))

Retrieve a value by a given key.

* key: type: string
* callback: type: function
* err: type: object
* response: type: string or object

## .mget(keys, callback (err, response))

Retrieve the values belonging to a series of keys. If a key is not found, it will not be in `response`.

* keys: type: an array of strings
* callback: type: function
* err: type: object
* response: type: object, example: {key: 'value', key2: 'value2'...}

## .set(key, value, [expiraiton], [refresh(key, cb)], [callback])

> See the [Using Background Refresh](#using-background-refresh) section for more about the `refresh` and `callback` params.

Set a value by a given key.

* key: type: string
* callback: type: function
* expiration: type: int, measure: seconds
* refresh: type: function
* callback: type: function

## .mset(obj, [expiration], [callback])

Set multiple values to multiple keys

* obj: type: object, example: {'key': 'value', 'key2': 'value2', 'key3': {cacheValue: 'value3', expiration: 60}}
* callback: type: function

This function exposes a heirarchy of expiration values as follows:
* The `expiration` property of a key that also contains a `cacheValue` property will override all other expirations. (This means that, if you are caching an object, the string 'cacheValue' is a reserved property name within that object.)
* If an object with both `cacheValue` and `expiration` as properties is not present, the `expiration` provided to the `.mset()` argument list will be used.
* If neither of the above is provided, each cache's `defaultExpiration` will be applied.

## .del(keys, [callback (err, count)])

Delete a key or an array of keys and their associated values.

* keys: type: string || array of strings
* callback: type: function
* err: type: object
* count: type: int

## .flush([cb])

Flush all keys and values.

* callback: type: function

## .memcachedClient

This is the underlying [Memcached](https://www.npmjs.com/package/memcached) client instance. If needed, you can access `memcachedClient` functions that haven't abstracted in the cache plugin.

# Using Background Refresh

With a typical cache setup, you're left to find the perfect compromise between having a long expiration so that users don't have to suffer through the worst case load time, and a short expiration so data doesn't get stale. `cache-service-memcached` eliminates the need to worry about users suffering through the longest wait time by automatically refreshing keys for you. Here's how it works:

> `cache-service-memcached` employs an intelligent background refresh algorithm that makes it so only one dyno executes a background refresh for any given key. You should feel confident that you will not encounter multiple dynos refreshing a single key.

#### How do I turn it on?

By default, background refresh is off. It will turn itself on the first time you pass a `refresh` param to `.set()`.

#### Configure

There are three options you can manipulate. See the API section for more information about them.

* `backgroundRefreshInterval`
* `backgroundRefreshMinTtl`
* `backgroundRefreshIntervalCheck`

#### Use

Background refresh is exposed via the `.set()` command as follows:

```javascript
cacheModule.set('key', 'value', 300, refresh, cb);
```

If you want to pass `refresh`, you must also pass `cb` because if only four params are passed, `cache-service-memcached` will assume the fourth param is `cb`.

#### The Refresh Param

###### refresh(key, cb(err, response))

* key: type: string: this is the key that is being refreshed
* cb: type: function: you must trigger this function to pass the data that should replace the current key's value

The `refresh` param MUST be a function that accepts `key` and a callback function that accepts `err` and `response` as follows:

```javascript
var refresh = function(key, cb){
  var response = goGetData();
  cb(null, response);
}
```

