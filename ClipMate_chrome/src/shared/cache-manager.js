/**
 * 多级缓存策略
 * 提供内存缓存、会话缓存和持久化缓存
 * 解决当前扩展缓存策略单一的问题
 */
class CacheManager {
  constructor(options = {}) {
    // 配置选项
    this.options = {
      // 内存缓存大小限制（条目数）
      memoryLimit: options.memoryLimit || 100,
      // 会话缓存大小限制（条目数）
      sessionLimit: options.sessionLimit || 500,
      // 持久化缓存大小限制（条目数）
      persistentLimit: options.persistentLimit || 1000,
      // 默认过期时间（毫秒）
      defaultTTL: options.defaultTTL || 24 * 60 * 60 * 1000, // 24小时
      // 清理间隔（毫秒）
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000, // 1小时
      // 前缀
      prefix: options.prefix || 'media_extractor_'
    };

    // 内存缓存（当前会话有效，最快）
    this.memoryCache = new Map();
    
    // 会话缓存（浏览器会话期间有效，较快）
    this.sessionCache = new Map();
    
    // 持久化缓存（跨会话有效，较慢）
    this.persistentCacheName = `${this.options.prefix}persistent_cache`;
    // 分片键前缀（v2.5.50）：每个缓存项单独一个 storage 键，改一项只写一项。
    // 旧版是把整个 persistentCache 装在一个键里，改一项就要全量重写。
    this.persistentShardPrefix = `${this.options.prefix}pcache:`;

    // 初始化持久化缓存
    this.initPersistentCache();
    
    // 启动定期清理
    this.startCleanup();
    
  }

  /**
   * 初始化持久化缓存
   *
   * 存储布局（v2.5.50 起）：一项一个键，键名 = persistentShardPrefix + fullKey。
   * 这样一次写入只碰一个键，不会因为改了 A 项的访问时间就把 B 项也重写一遍。
   * 同时兼容旧版单键布局（prefix + 'persistent_cache'）：发现旧数据就自动拆成分片。
   */
  async initPersistentCache() {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[CacheManager] 扩展上下文已失效，使用空的持久化缓存');
        this.persistentCache = {};
        return;
      }

      if (typeof chrome !== 'undefined' && WBR.storage && WBR.storage.local) {
        // get(null) 取回本扩展的全部本地存储（设置项也在里面，所以下面按前缀过滤）
        const all = (await WBR.storage.local.get(null)) || {};
        this.persistentCache = {};

        for (const storageKey in all) {
          if (!Object.prototype.hasOwnProperty.call(all, storageKey)) continue;
          if (storageKey.indexOf(this.persistentShardPrefix) === 0) {
            const fullKey = storageKey.slice(this.persistentShardPrefix.length);
            this.persistentCache[fullKey] = all[storageKey];
          }
        }

        // 迁移旧版单键数据：只补分片里没有的，写完就把旧键删掉
        const legacy = all[this.persistentCacheName];
        if (legacy && typeof legacy === 'object') {
          const patch = {};
          for (const fullKey in legacy) {
            if (!Object.prototype.hasOwnProperty.call(legacy, fullKey)) continue;
            if (Object.prototype.hasOwnProperty.call(this.persistentCache, fullKey)) continue;
            this.persistentCache[fullKey] = legacy[fullKey];
            patch[this.persistentShardPrefix + fullKey] = legacy[fullKey];
          }
          const movedCount = Object.keys(patch).length;
          if (movedCount > 0) {
            await WBR.storage.local.set(patch);
          }
          await WBR.storage.local.remove(this.persistentCacheName);
          if (movedCount > 0) {
            ClipMateLog.debug(`[CacheManager] 旧版持久化缓存已拆分为 ${movedCount} 个分片`);
          }
        }
      } else {
        // 降级到 localStorage：同样按前缀逐个键读
        this.persistentCache = {};
        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i);
          if (!storageKey || storageKey.indexOf(this.persistentShardPrefix) !== 0) continue;
          const fullKey = storageKey.slice(this.persistentShardPrefix.length);
          try {
            this.persistentCache[fullKey] = JSON.parse(localStorage.getItem(storageKey) || 'null');
          } catch (e) {
            ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message);
          }
        }
        // 旧版单键
        const legacyRaw = localStorage.getItem(this.persistentCacheName);
        if (legacyRaw) {
          try {
            const legacy = JSON.parse(legacyRaw) || {};
            for (const fullKey in legacy) {
              if (!Object.prototype.hasOwnProperty.call(legacy, fullKey)) continue;
              if (Object.prototype.hasOwnProperty.call(this.persistentCache, fullKey)) continue;
              this.persistentCache[fullKey] = legacy[fullKey];
              localStorage.setItem(this.persistentShardPrefix + fullKey, JSON.stringify(legacy[fullKey]));
            }
          } catch (e) {
            ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message);
          }
          localStorage.removeItem(this.persistentCacheName);
        }
      }
    } catch (error) {
      // 检查是否是扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[CacheManager] 扩展上下文已失效，使用空的持久化缓存');
        this.persistentCache = {};
      } else {
        console.error('[CacheManager] 初始化持久化缓存失败:', error);
        this.persistentCache = {};
      }
    }
  }

  /**
   * 启动定期清理
   */
  startCleanup() {
    // 设置定时清理
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.options.cleanupInterval);
  }

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 获取缓存项
   * @param {string} key - 缓存键
   * @param {Object} options - 选项
   * @returns {Promise<any>} 缓存值
   */
  async get(key, options = {}) {
    const fullKey = this.options.prefix + key;
    
    // 1. 尝试从内存缓存获取
    if (this.memoryCache.has(fullKey)) {
      const item = this.memoryCache.get(fullKey);
      if (!this.isExpired(item)) {
        ClipMateLog.debug(`[CacheManager] 从内存缓存获取: ${key}`);
        return item.value;
      } else {
        this.memoryCache.delete(fullKey);
      }
    }
    
    // 2. 尝试从会话缓存获取
    if (this.sessionCache.has(fullKey)) {
      const item = this.sessionCache.get(fullKey);
      if (!this.isExpired(item)) {
        ClipMateLog.debug(`[CacheManager] 从会话缓存获取: ${key}`);
        // 提升到内存缓存
        this.setMemoryCache(fullKey, item);
        return item.value;
      } else {
        this.sessionCache.delete(fullKey);
      }
    }
    
    // 3. 尝试从持久化缓存获取
    if (this.persistentCache.hasOwnProperty(fullKey)) {
      const item = this.persistentCache[fullKey];
      if (!this.isExpired(item)) {
        ClipMateLog.debug(`[CacheManager] 从持久化缓存获取: ${key}`);
        // 提升到会话缓存和内存缓存
        this.setSessionCache(fullKey, item);
        this.setMemoryCache(fullKey, item);
        return item.value;
      } else {
        delete this.persistentCache[fullKey];
        await this.savePersistentCache(fullKey);
      }
    }
    
    // 未找到缓存项
    ClipMateLog.debug(`[CacheManager] 缓存未命中: ${key}`);
    return null;
  }

  /**
   * 设置缓存项
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {Object} options - 选项
   * @returns {Promise<void>}
   */
  async set(key, value, options = {}) {
    const fullKey = this.options.prefix + key;
    const ttl = options.ttl || this.options.defaultTTL;
    const expires = Date.now() + ttl;
    
    const item = {
      value,
      expires,
      created: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now()
    };
    
    // 根据选项决定缓存级别
    if (options.persistent) {
      // 持久化缓存
      this.persistentCache[fullKey] = item;
      await this.savePersistentCache(fullKey);
      ClipMateLog.debug(`[CacheManager] 已保存到持久化缓存: ${key}`);
    } else if (options.session) {
      // 会话缓存
      this.setSessionCache(fullKey, item);
      ClipMateLog.debug(`[CacheManager] 已保存到会话缓存: ${key}`);
    } else {
      // 内存缓存（默认）
      this.setMemoryCache(fullKey, item);
      ClipMateLog.debug(`[CacheManager] 已保存到内存缓存: ${key}`);
    }
  }

  /**
   * 设置内存缓存
   * @param {string} key - 缓存键
   * @param {Object} item - 缓存项
   */
  setMemoryCache(key, item) {
    // 检查大小限制
    if (this.memoryCache.size >= this.options.memoryLimit) {
      this.evictLRU(this.memoryCache);
    }
    
    this.memoryCache.set(key, item);
  }

  /**
   * 设置会话缓存
   * @param {string} key - 缓存键
   * @param {Object} item - 缓存项
   */
  setSessionCache(key, item) {
    // 检查大小限制
    if (this.sessionCache.size >= this.options.sessionLimit) {
      this.evictLRU(this.sessionCache);
    }
    
    this.sessionCache.set(key, item);
  }

  /**
   * 检查缓存项是否过期
   * @param {Object} item - 缓存项
   * @returns {boolean} 是否过期
   */
  isExpired(item) {
    return item.expires && Date.now() > item.expires;
  }

  /**
   * 使用LRU算法驱逐缓存项
   * @param {Map} cache - 缓存Map
   */
  evictLRU(cache) {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      cache.delete(oldestKey);
      ClipMateLog.debug(`[CacheManager] LRU驱逐: ${oldestKey}`);
    }
  }

  /**
   * 删除缓存项
   * @param {string} key - 缓存键
   * @returns {Promise<void>}
   */
  async delete(key) {
    const fullKey = this.options.prefix + key;
    
    // 从各级缓存删除
    this.memoryCache.delete(fullKey);
    this.sessionCache.delete(fullKey);
    
    if (this.persistentCache.hasOwnProperty(fullKey)) {
      delete this.persistentCache[fullKey];
      await this.savePersistentCache(fullKey);
    }
    
    ClipMateLog.debug(`[CacheManager] 已删除缓存项: ${key}`);
  }

  /**
   * 清空所有缓存
   * @returns {Promise<void>}
   */
  async clear() {
    this.memoryCache.clear();
    this.sessionCache.clear();
    this.persistentCache = {};
    await this.savePersistentCache();
    
    ClipMateLog.debug('[CacheManager] 已清空所有缓存');
  }

  /**
   * 清空指定级别的缓存
   * @param {string} level - 缓存级别 (memory, session, persistent)
   * @returns {Promise<void>}
   */
  async clearLevel(level) {
    switch (level) {
      case 'memory':
        this.memoryCache.clear();
        break;
      case 'session':
        this.sessionCache.clear();
        break;
      case 'persistent':
        this.persistentCache = {};
        await this.savePersistentCache();
        break;
      default:
        throw new Error(`未知的缓存级别: ${level}`);
    }
    
    ClipMateLog.debug(`[CacheManager] 已清空${level}级缓存`);
  }

  /**
   * 清理过期缓存项
   * @returns {Promise<void>}
   */
  async cleanupExpired() {
    let cleanedCount = 0;
    
    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      if (this.isExpired(item)) {
        this.memoryCache.delete(key);
        cleanedCount++;
      }
    }
    
    // 清理会话缓存
    for (const [key, item] of this.sessionCache.entries()) {
      if (this.isExpired(item)) {
        this.sessionCache.delete(key);
        cleanedCount++;
      }
    }
    
    // 清理持久化缓存
    const persistentRemoved = [];
    for (const key in this.persistentCache) {
      if (this.isExpired(this.persistentCache[key])) {
        delete this.persistentCache[key];
        cleanedCount++;
        persistentRemoved.push(key);
      }
    }
    
    if (persistentRemoved.length > 0) {
      await this.removePersistentShards(persistentRemoved);
    }
    
    if (cleanedCount > 0) {
      ClipMateLog.debug(`[CacheManager] 清理了 ${cleanedCount} 个过期缓存项`);
    }
  }

  /**
   * 检查扩展上下文是否有效
   * @returns {boolean} 上下文是否有效
   */
  isContextValid() {
    try {
      // 尝试访问chrome对象的一个简单属性，如果上下文失效会抛出异常
      return typeof chrome !== 'undefined' && 
             WBR.runtime && 
             typeof WBR.runtime.id === 'string';
    } catch (error) {
      return false;
    }
  }

  /**
   * 保存持久化缓存（按分片只写变化的那一项）
   * @param {string} [fullKey] 只同步这一项；不传则把内存里的缓存整体对齐到存储（清空/清空某级时用）
   * @returns {Promise<void>}
   */
  async savePersistentCache(fullKey) {
    try {
      // 检查扩展上下文是否有效
      if (!this.isContextValid()) {
        console.warn('[CacheManager] 扩展上下文已失效，跳过持久化缓存保存');
        return;
      }

      if (typeof chrome !== 'undefined' && WBR.storage && WBR.storage.local) {
        if (fullKey) {
          const storageKey = this.persistentShardPrefix + fullKey;
          if (Object.prototype.hasOwnProperty.call(this.persistentCache, fullKey)) {
            await WBR.storage.local.set({ [storageKey]: this.persistentCache[fullKey] });
          } else {
            // 内存里已经没有了（删除/过期），把分片也删掉
            await WBR.storage.local.remove(storageKey);
          }
        } else {
          await this.replaceAllShards();
        }
      } else {
        if (fullKey) {
          const storageKey = this.persistentShardPrefix + fullKey;
          if (Object.prototype.hasOwnProperty.call(this.persistentCache, fullKey)) {
            localStorage.setItem(storageKey, JSON.stringify(this.persistentCache[fullKey]));
          } else {
            localStorage.removeItem(storageKey);
          }
        } else {
          await this.replaceAllShards();
        }
      }
    } catch (error) {
      // 检查是否是扩展上下文失效错误
      if (error.message && error.message.includes('Extension context invalidated')) {
        console.warn('[CacheManager] 扩展上下文已失效，持久化缓存保存失败:', error);
        // 如果上下文失效，停止定期清理
        this.stopCleanup();
      } else {
        console.error('[CacheManager] 保存持久化缓存失败:', error);
      }
    }
  }

  /**
   * 把存储里的分片整体替换成当前内存里的 persistentCache（清空、清空某一级时用）
   * @returns {Promise<void>}
   */
  async replaceAllShards() {
    const entries = [];
    for (const fullKey in this.persistentCache) {
      if (!Object.prototype.hasOwnProperty.call(this.persistentCache, fullKey)) continue;
      entries.push([this.persistentShardPrefix + fullKey, this.persistentCache[fullKey]]);
    }

    if (typeof chrome !== 'undefined' && WBR.storage && WBR.storage.local) {
      const all = (await WBR.storage.local.get(null)) || {};
      const staleKeys = [];
      for (const storageKey in all) {
        if (storageKey.indexOf(this.persistentShardPrefix) === 0) staleKeys.push(storageKey);
      }
      if (staleKeys.length > 0) {
        await WBR.storage.local.remove(staleKeys);
      }
      if (entries.length > 0) {
        const patch = {};
        entries.forEach(([k, v]) => { patch[k] = v; });
        await WBR.storage.local.set(patch);
      }
      return;
    }

    // localStorage 分支
    const staleKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey && storageKey.indexOf(this.persistentShardPrefix) === 0) staleKeys.push(storageKey);
    }
    staleKeys.forEach((k) => localStorage.removeItem(k));
    entries.forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
  }

  /**
   * 批量删除分片（清理过期项时用，避免逐项 await）
   * @param {string[]} fullKeys 缓存键数组（不含分片前缀）
   * @returns {Promise<void>}
   */
  async removePersistentShards(fullKeys) {
    if (!fullKeys || fullKeys.length === 0) return;
    try {
      if (!this.isContextValid()) {
        console.warn('[CacheManager] 扩展上下文已失效，跳过持久化缓存删除');
        return;
      }
      const storageKeys = fullKeys.map((k) => this.persistentShardPrefix + k);
      if (typeof chrome !== 'undefined' && WBR.storage && WBR.storage.local) {
        await WBR.storage.local.remove(storageKeys);
      } else {
        storageKeys.forEach((k) => localStorage.removeItem(k));
      }
    } catch (error) {
      console.error('[CacheManager] 删除持久化缓存分片失败:', error);
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 缓存统计信息
   */
  getStats() {
    return {
      memory: {
        size: this.memoryCache.size,
        limit: this.options.memoryLimit
      },
      session: {
        size: this.sessionCache.size,
        limit: this.options.sessionLimit
      },
      persistent: {
        size: Object.keys(this.persistentCache).length,
        limit: this.options.persistentLimit
      }
    };
  }

  /**
   * 销毁缓存管理器
   */
  destroy() {
    this.stopCleanup();
    this.memoryCache.clear();
    this.sessionCache.clear();
    this.persistentCache = {};
    
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CacheManager;
}