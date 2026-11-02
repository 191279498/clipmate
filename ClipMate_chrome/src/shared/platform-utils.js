/**
 * 平台名称标准化工具
 * 提供游戏平台名称的标准化转换功能
 * 使用豆瓣游戏平台名称作为标准
 */

// 直接挂载到window对象上，避免export语法在浏览器扩展中的兼容性问题
window.PlatformUtils = class PlatformUtils {
  /**
   * 获取平台名称对照转换表
   * 以豆瓣游戏平台名称为标准
   * @returns {Object} 平台名称映射对象
   */
  static getPlatformConversionMap() {
    return {
      // Xbox系列
      'Xbox Series X/S': 'XSX',
      'Xbox Series X': 'XSX',
      'Xbox Series S': 'XSX',
      'Xbox One X': 'Xbox One',
      'Xbox One S': 'Xbox One',
      'Xbox One': 'Xbox One',
      'Xbox 360': 'Xbox 360',
      
      // PlayStation系列
      'PS5': 'PS5',
      'PlayStation 5': 'PS5',
      'PS4': 'PS4',
      'PlayStation 4': 'PS4',
      'PS3': 'PS3',
      'PlayStation 3': 'PS3',
      
      // Nintendo系列
      'Switch': 'Switch',
      'Nintendo Switch': 'Switch',
      'Switch OLED': 'Switch',
      'Switch Lite': 'Switch',
      'Wii U': 'Wii U',
      'Wii': 'Wii',
      '3DS': '3DS',
      '3DS LL': '3DS',
      'New 3DS': '3DS',
      '2DS': '2DS',
      'DS': 'DS',
      'DSi': 'DS',
      
      // PC平台
      'PC': 'PC',
      'Windows': 'PC',
      'Microsoft Windows': 'PC',
      'macOS': 'Mac',
      'Mac OS X': 'Mac',
      'Mac': 'Mac',
      'Linux': 'Linux',
      'SteamOS': 'Linux',
      
      // 掌机
      'Steam Deck': 'Steam Deck',
      'PS Vita': 'PSV',
      'PSP': 'PSP',
      'PSP Go': 'PSP',
      'Nintendo DS': 'DS',
      'Nintendo DSi': 'DS',
      
      // 移动平台
      'iOS': 'iOS',
      'iPadOS': 'iOS',
      'Android': 'Android',
      'Android TV': 'Android',
      'Google Stadia': 'Stadia',
      'Stadia': 'Stadia',
      
      // 其他
      'Dreamcast': 'DC',
      'DC': 'DC',
      'PlayStation': 'PS',
      'PS': 'PS',
      'PlayStation 2': 'PS2',
      'PS2': 'PS2',
      'Xbox': 'Xbox',
      'GameCube': 'GC',
      'GC': 'GC',
      'Nintendo 64': 'N64',
      'N64': 'N64'
    };
  }

  /**
   * 标准化单个平台名称
   * @param {string} platform - 原始平台名称
   * @returns {string} 标准化后的平台名称
   */
  static standardizePlatformName(platform) {
    const conversionMap = this.getPlatformConversionMap();
    
    // 先尝试精确匹配
    if (conversionMap[platform]) {
      return conversionMap[platform];
    }
    
    // 尝试模糊匹配（处理包含额外空格或符号的情况）
    const normalizedPlatform = platform.trim().toLowerCase();
    for (const [source, target] of Object.entries(conversionMap)) {
      if (source.toLowerCase() === normalizedPlatform) {
        return target;
      }
    }
    
    // 特殊处理：处理"Xbox Series X, S"这种错误分割的情况
    if (platform.includes('Xbox Series X') && platform.includes('S')) {
      return 'XSX';
    }
    
    // 如果没有匹配项，返回原始平台名称
    return platform;
  }

  /**
   * 标准化平台名称数组
   * @param {Array<string>} platforms - 原始平台名称数组
   * @returns {Array<string>} 标准化后的平台名称数组（已去重）
   */
  static standardizePlatforms(platforms) {
    // 去重并标准化每个平台名称
    const uniquePlatforms = [...new Set(platforms)];
    const standardizedPlatforms = uniquePlatforms.map(platform => 
      this.standardizePlatformName(platform)
    );
    
    // 再次去重（因为不同的原始平台可能映射到同一个标准平台）
    return [...new Set(standardizedPlatforms)];
  }

  /**
   * 标准化平台名称字符串（逗号分隔）
   * @param {string} platformsStr - 逗号分隔的平台名称字符串
   * @returns {string} 标准化后的平台名称字符串
   */
  static standardizePlatformsString(platformsStr) {
    if (!platformsStr || platformsStr.trim() === '') {
      return '';
    }
    
    // 按逗号分割
    const platforms = platformsStr.split(/[,，]/).map(p => p.trim()).filter(p => p !== '');
    const standardized = this.standardizePlatforms(platforms);
    return standardized.join(', ');
  }
};

