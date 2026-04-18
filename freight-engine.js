/**
 * FreightEngine — 多物流商插件化运费计算引擎
 *
 * 使用方法：
 *   engine.register(new ZTORFBSCarrier());
 *   engine.setCarrier('ZTO-rFBS');
 *   const result = engine.calculate({ weight_kg, value_rub, length, width, height });
 *
 * 新增物流商：实现 CarrierPlugin 接口后调用 engine.register() 即可。
 */
class FreightEngine {
  constructor() {
    this._carriers = new Map();
    this._active = null;
  }

  /**
   * 注册物流商插件
   * 要求插件实现：
   *   get name()     → string
   *   get label()    → string  (显示名称)
   *   get version()  → string
   *   calculate(params) → object
   */
  register(carrier) {
    if (!carrier.name || typeof carrier.calculate !== 'function') {
      throw new Error('CarrierPlugin 必须实现 name 和 calculate()');
    }
    this._carriers.set(carrier.name, carrier);
    if (!this._active) this._active = carrier.name;
  }

  /** 切换当前物流商 */
  setCarrier(name) {
    if (!this._carriers.has(name)) throw new Error(`未注册的物流商: ${name}`);
    this._active = name;
  }

  /** 获取当前物流商插件 */
  get currentCarrier() {
    return this._carriers.get(this._active);
  }

  /** 获取所有已注册物流商列表 */
  get carrierList() {
    return [...this._carriers.values()].map(c => ({
      name: c.name,
      label: c.label || c.name,
      version: c.version,
    }));
  }

  /**
   * 执行运费计算（委托给当前物流商插件）
   * @param {object} params - { weight_kg, value_rub, length, width, height }
   * @returns {object} 计算结果
   */
  calculate(params) {
    if (!this._active) throw new Error('尚未注册任何物流商');
    return this.currentCarrier.calculate(params);
  }
}

// 全局单例
const freightEngine = new FreightEngine();

if (typeof module !== 'undefined') {
  module.exports = { FreightEngine, freightEngine };
}
