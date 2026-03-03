/**
 * Imagine Storage Manager
 * 管理 imagine 图片历史记录的 localStorage 存储
 */

class ImagineStorage {
  constructor() {
    this.storageKey = 'imagine_history';
  }

  /**
   * 加载历史记录
   * @returns {Array} 图片历史记录数组
   */
  load() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load imagine history:', e);
      return [];
    }
  }

  /**
   * 保存历史记录
   * @param {Array} history - 图片历史记录数组
   * @returns {boolean} 是否保存成功
   */
  save(history) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(history));
      return true;
    } catch (e) {
      console.error('Failed to save imagine history:', e);
      if (e.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded. Consider clearing old data.');
      }
      return false;
    }
  }

  /**
   * 添加新图片
   * @param {Object} imageData - 图片数据
   * @returns {string} 图片 ID
   */
  addImage(imageData) {
    const history = this.load();
    const newImage = {
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt: imageData.prompt || '',
      grokUrl: imageData.grokUrl || '',
      imageData: imageData.imageData || '',
      imageId: imageData.imageId || '',
      aspectRatio: imageData.aspectRatio || '',
      elapsedMs: imageData.elapsedMs || 0,
      nsfw: imageData.nsfw || false,
      timestamp: Date.now(),
      sequence: imageData.sequence || 0,
      edits: []
    };
    history.push(newImage);
    this.save(history);
    return newImage.id;
  }

  /**
   * 添加编辑记录（图生图变体）
   * @param {string} parentId - 父图片 ID
   * @param {Object} editData - 编辑数据
   * @returns {string|null} 新图片 ID
   */
  addEdit(parentId, editData) {
    const history = this.load();
    const parent = history.find(img => img.id === parentId);
    if (!parent) {
      return null;
    }
    
    const newImage = {
      id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt: editData.prompt || '',
      grokUrl: editData.grokUrl || '',
      imageData: editData.imageData || '',
      imageId: editData.imageId || '',
      aspectRatio: editData.aspectRatio || '',
      elapsedMs: editData.elapsedMs || 0,
      nsfw: editData.nsfw || false,
      timestamp: Date.now(),
      sequence: editData.sequence || 0,
      edits: [],
      parentId: parentId
    };
    
    if (!parent.edits) {
      parent.edits = [];
    }
    parent.edits.push(newImage.id);
    
    history.push(newImage);
    this.save(history);
    
    return newImage.id;
  }

  /**
   * 更新图片数据
   * @param {string} imageId - 图片 ID
   * @param {Object} updates - 要更新的字段
   * @returns {boolean} 是否更新成功
   */
  updateImage(imageId, updates) {
    const history = this.load();
    const image = history.find(img => img.id === imageId);
    if (!image) {
      return false;
    }
    
    // 更新字段
    Object.assign(image, updates);
    
    this.save(history);
    return true;
  }

  /**
   * 获取图片详情（包含编辑历史）
   * @param {string} imageId - 图片 ID
   * @returns {Object|null} 图片数据
   */
  getImage(imageId) {
    const history = this.load();
    return history.find(img => img.id === imageId) || null;
  }

  /**
   * 获取所有图片
   * @returns {Array} 所有图片数组
   */
  getAllImages() {
    return this.load();
  }

  /**
   * 删除图片
   * @param {string} imageId - 图片 ID
   * @returns {boolean} 是否删除成功
   */
  deleteImage(imageId) {
    const history = this.load();
    const filtered = history.filter(img => img.id !== imageId);
    return this.save(filtered);
  }

  /**
   * 清空所有历史
   * @returns {boolean} 是否清空成功
   */
  clear() {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch (e) {
      console.error('Failed to clear imagine history:', e);
      return false;
    }
  }

  /**
   * 获取存储大小（估算）
   * @returns {number} 存储大小（字节）
   */
  getStorageSize() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? new Blob([data]).size : 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * 获取图片数量
   * @returns {number} 图片数量
   */
  getImageCount() {
    return this.load().length;
  }
}

// 创建全局实例
const imagineStorage = new ImagineStorage();
