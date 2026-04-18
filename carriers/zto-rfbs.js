/**
 * ZTO-rFBS 物流运费计算插件
 * 数据来源：ZTO-rFBS物流综合服务报价表v6.3 Big密度版
 * 所有公式逻辑与表格100%一致
 */
class ZTORFBSCarrier {
  get name() { return 'ZTO-rFBS'; }
  get label() { return '中通跨境 ZTO-rFBS (v6.3 Big密度版)'; }
  get version() { return 'v6.3'; }
  get currency() { return 'RUB'; }

  // ─── 货件分组矩阵 ───────────────────────────────────────────────────────────
  // 重量行索引: (0,0.5]=0, (0.5,2]=1, (2,5]=2, (5,30]=3, >30=4
  // 货值列索引: (0,1500]=0, (1500,7000]=1, (7000,250000]=2, >250000=3
  _GROUP_MATRIX = [
    ['Extra Small', 'Small',        'Premium Small', '超出最高货值'],
    ['Budget',      'Small',        'Premium Small', '超出最高货值'],
    ['Budget',      'Big',          'Premium Small', '超出最高货值'],
    ['Budget',      'Big',          'Premium Big',   '超出最高货值'],
    ['超出最大重量',   '超出最大重量',    '超出最大重量',    '超出最高货值、最大重量'],
  ];

  // 尺寸限制 [三边之和上限, 最大边长上限]
  _SIZE_LIMITS = {
    'Extra Small':  [90,  60],
    'Budget':       [150, 60],
    'Small':        [150, 60],
    'Big':          [250, 150],
    'Premium Small':[250, 150],
    'Premium Big':  [310, 150],
  };

  // Extra Small 密度阈值
  _DENSITY_THRESHOLD = 55; // kg/m³

  /**
   * 向上取整到整数克（与Excel ROUNDUP(...,0)一致）
   * 注意：对浮点误差做处理
   */
  _ceilGrams(kg) {
    const g = kg * 1000;
    return Math.ceil(Math.round(g * 1e10) / 1e10);
  }

  /**
   * 确定重量行索引
   */
  _weightRow(weight_kg) {
    const g = Math.ceil(Math.round(weight_kg * 1000 * 1e10) / 1e10);
    if (g >= 1 && g <= 500)   return 0; // (0, 0.5]
    if (g > 500 && g <= 2000) return 1; // (0.5, 2]
    if (g > 2000 && g <= 5000)return 2; // (2, 5]
    if (g > 5000 && g <= 30000)return 3;// (5, 30]
    return 4; // > 30kg
  }

  /**
   * 确定货值列索引（卢布）
   */
  _valueCol(value_rub) {
    if (value_rub >= 1 && value_rub <= 1500)    return 0;
    if (value_rub > 1500 && value_rub <= 7000)  return 1;
    if (value_rub > 7000 && value_rub <= 250000)return 2;
    return 3; // > 250000
  }

  /**
   * 货件分组
   * @param {number} weight_kg - 实重（千克）
   * @param {number} value_rub - 货值（卢布）
   * @returns {string} 货件组别
   */
  classify(weight_kg, value_rub) {
    if (weight_kg <= 0 || value_rub <= 0) return null;
    const row = this._weightRow(weight_kg);
    const col = this._valueCol(value_rub);
    return this._GROUP_MATRIX[row][col];
  }

  /**
   * 尺寸校验
   * @returns {{ result, sumEdges, maxEdge }}
   */
  checkSize(group, length, width, height) {
    const limits = this._SIZE_LIMITS[group];
    if (!limits) return { result: '货件组别无效', sumEdges: 0, maxEdge: 0 };
    const sumEdges = length + width + height;
    const maxEdge = Math.max(length, width, height);
    const [maxSum, maxSingle] = limits;
    const sumOk = sumEdges <= maxSum;
    const singleOk = maxEdge <= maxSingle;
    let result;
    if (sumOk && singleOk)    result = '限定区间内';
    else if (!sumOk && singleOk) result = '三边之和超出限制';
    else if (sumOk && !singleOk) result = '最大边长超出限制';
    else                      result = '三边和&最大边超限';
    return { result, sumEdges, maxEdge };
  }

  /**
   * 密度校验（仅 Extra Small Big密度版）
   * @returns {{ density, pass, label }} density 单位 kg/m³
   */
  checkDensity(weight_kg, length, width, height) {
    const volumeM3 = (length * width * height) / 1_000_000;
    if (volumeM3 === 0) return { density: null, pass: null, label: '尺寸为零' };
    const density = weight_kg / volumeM3;
    const pass = density > this._DENSITY_THRESHOLD;
    return {
      density: +density.toFixed(2),
      pass,
      label: pass ? '可发' : `密度≤${this._DENSITY_THRESHOLD}kg/m³，不可发`,
    };
  }

  /**
   * 计算是否计抛
   * - Budget/Small/Premium Small: 若 LWH/24000 >= 实重 → 是
   * - Big/Premium Big:            若 LWH/12000 >= 实重 → 是
   * - Extra Small: 否
   */
  checkVolumetric(group, weight_kg, length, width, height) {
    if (group === 'Extra Small') return false;
    const vol12000 = (length * width * height) / 12000;
    const vol24000 = (length * width * height) / 24000;
    if (['Budget', 'Small', 'Premium Small'].includes(group)) {
      return vol24000 >= weight_kg;
    }
    return vol12000 >= weight_kg; // Big, Premium Big
  }

  /**
   * 获取计费重量（千克）
   * @param {string} tier - 'express' | 'standard' | 'economy'
   */
  _billingWeight(group, weight_kg, length, width, height, tier) {
    if (group === 'Extra Small') return weight_kg;
    const vol12000 = (length * width * height) / 12000;
    const vol24000 = (length * width * height) / 24000;
    if (tier === 'economy' && group === 'Premium Small') {
      return Math.max(weight_kg, vol24000);
    }
    return Math.max(weight_kg, vol12000);
  }

  /**
   * 计算单档运费
   * @param {string} group - 货件组别
   * @param {string} tier  - 'express' | 'standard' | 'economy'
   * @param {number} billing_kg - 计费重量（千克）
   * @returns {number|null} 运费RMB，null=不可用
   */
  _calcFee(group, tier, billing_kg) {
    const g = this._ceilGrams(billing_kg);

    // Express (空运)
    if (tier === 'express') {
      if (group === 'Extra Small')   return g < 1 ? 3.1668  : +(g * 0.0468 + 3.12).toFixed(4);
      if (group === 'Budget')        return g < 1 ? 23.95432: +(g * 0.03432 + 23.92).toFixed(4);
      if (group === 'Small')         return g < 1 ? 16.6868 : +(g * 0.0468 + 16.64).toFixed(4);
      if (group === 'Big')           return g < 1 ? 37.47432: +(g * 0.03432 + 37.44).toFixed(4);
      if (group === 'Premium Small') return g < 1 ? 22.9268 : +(g * 0.0468 + 22.88).toFixed(4);
      if (group === 'Premium Big')   return null; // 未上线
    }

    // Standard (陆空)
    if (tier === 'standard') {
      if (group === 'Extra Small')   return g < 1 ? 3.1564  : +(g * 0.0364 + 3.12).toFixed(4);
      if (group === 'Budget')        return g < 1 ? 23.946  : +(g * 0.026 + 23.92).toFixed(4);
      if (group === 'Small')         return g < 1 ? 16.6764 : +(g * 0.0364 + 16.64).toFixed(4);
      if (group === 'Big')           return g < 1 ? 37.466  : +(g * 0.026 + 37.44).toFixed(4);
      if (group === 'Premium Small') return g < 1 ? 22.9164 : +(g * 0.0364 + 22.88).toFixed(4);
      if (group === 'Premium Big')   return g < 1 ? 64.50912: +(g * 0.02912 + 64.48).toFixed(4);
    }

    // Economy (陆运)
    if (tier === 'economy') {
      if (group === 'Extra Small')   return g < 1 ? 3.146   : +(g * 0.026 + 3.12).toFixed(4);
      if (group === 'Budget')        return g < 1 ? 23.93768: +(g * 0.01768 + 23.92).toFixed(4);
      if (group === 'Small')         return g < 1 ? 16.666  : +(g * 0.026 + 16.64).toFixed(4);
      if (group === 'Big')           return g < 1 ? 37.45768: +(g * 0.01768 + 37.44).toFixed(4);
      if (group === 'Premium Small') return g < 1 ? 22.906  : +(g * 0.026 + 22.88).toFixed(4);
      if (group === 'Premium Big')   return g < 1 ? 64.50392: +(g * 0.02392 + 64.48).toFixed(4);
    }

    return null;
  }

  /**
   * 完整计算入口
   * @param {object} params
   * @param {number} params.weight_kg  - 实重（千克）
   * @param {number} params.value_rub  - 货值（卢布）
   * @param {number} params.length     - 长（厘米）
   * @param {number} params.width      - 宽（厘米）
   * @param {number} params.height     - 高（厘米）
   * @returns {object} 完整计算结果
   */
  calculate({ weight_kg, value_rub, length, width, height }) {
    const result = {
      carrier: this.name,
      version: this.version,
      inputs: { weight_kg, value_rub, length, width, height },
      group: null,
      groupError: null,
      sizeCheck: null,
      densityCheck: null,
      isVolumetric: null,
      express: null,
      standard: null,
      economy: null,
      bigPricing: null, // Big密度版特有
    };

    // 1. 货件分组
    const group = this.classify(weight_kg, value_rub);
    result.group = group;

    const errors = ['超出最高货值', '超出最大重量', '超出最高货值、最大重量'];
    if (!group || errors.includes(group)) {
      result.groupError = group || '参数无效';
      return result;
    }

    // 2. 尺寸校验（需要尺寸）
    const hasDimensions = length > 0 && width > 0 && height > 0;
    if (hasDimensions) {
      result.sizeCheck = this.checkSize(group, length, width, height);
    }

    const sizeOk = !hasDimensions || result.sizeCheck?.result === '限定区间内';
    if (!sizeOk) return result;

    // 3. 密度校验（仅 Extra Small + Big密度版）
    if (group === 'Extra Small' && hasDimensions) {
      result.densityCheck = this.checkDensity(weight_kg, length, width, height);
      if (!result.densityCheck.pass) return result;
    }

    // 4. 是否计抛
    if (hasDimensions) {
      result.isVolumetric = this.checkVolumetric(group, weight_kg, length, width, height);
    }

    // 5. 三档运费计算
    const tiers = ['express', 'standard', 'economy'];
    for (const tier of tiers) {
      const billing_kg = hasDimensions
        ? this._billingWeight(group, weight_kg, length, width, height, tier)
        : weight_kg;
      const fee = this._calcFee(group, tier, billing_kg);
      result[tier] = {
        billingWeight_kg: +billing_kg.toFixed(6),
        billingWeight_g: this._ceilGrams(billing_kg),
        fee_rmb: fee,
        unavailable: fee === null,
      };
    }

    // 6. Big密度版特殊展示
    if (group === 'Big') {
      result.bigPricing = {
        air:      { label: 'Big空运（Express）', rate: '¥37.44 + ¥0.03432/1克' },
        airGround:{ label: 'Big陆空（Standard）',rate: '¥37.44 + ¥0.026/1克'  },
        ground:   { label: 'Big陆运（Economy）', rate: '¥37.44 + ¥0.01768/1克'},
      };
    }

    return result;
  }

  // ─── 增值服务费率表（只读参考） ─────────────────────────────────────────────
  get valueAddedServices() {
    return [
      { service: '贴单',          unit: '元/单', price: 1.5,  note: '' },
      { service: '拆包',          unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '合包',          unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '拆分+交叉合包',  unit: '元/单', price: 4,    note: '含基础耗材' },
      { service: '再包装',        unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '额外加固基础',   unit: '元/单', price: 2.5,  note: '+分级：≤3kg +1；3-10kg +2；>10kg/易碎 +3' },
      { service: '拆包质检',      unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '拍照验货',      unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '添加配件',      unit: '元/单', price: 3,    note: '含基础耗材' },
      { service: '退货改派',      unit: '元/单', price: 3,    note: 'SKU需与原单一致' },
      { service: '仓储（0-30天）', unit: '免费',  price: 0,    note: '' },
      { service: '仓储（31-90天）',unit: '元/单/天',price: 2,  note: '超长件(三边和>120cm)加+3元/单/天' },
      { service: '销毁',          unit: '免费',  price: 0,    note: '90天未操作自动销毁' },
    ];
  }

  // ─── 仓库信息 ────────────────────────────────────────────────────────────
  get warehouses() {
    return [
      { city: '杭州', contact: '胡文炳 18758224593', address: '浙江省杭州市临平区塘栖镇智启街1号中通云仓科技有限公司五号楼二楼月台Ozon集货仓' },
      { city: '东莞', contact: '刘双双 18627695782', address: '广东省东莞市沙田镇临海北路5号中通快递E栋3楼Ozon集货仓' },
      { city: '泉州', contact: '中通星隆跨境云仓 15159553388', address: '福建省泉州市晋江市磁灶镇陶美路550号普达雅艺物流园9号电梯五楼Ozon集货仓' },
      { city: '厦门', contact: '陈伟 15105998277', address: '福建省厦门市集美区天安路122-112号Ozon集货仓' },
    ];
  }
}

// 导出（兼容浏览器直接引用和模块化）
if (typeof module !== 'undefined') module.exports = ZTORFBSCarrier;
