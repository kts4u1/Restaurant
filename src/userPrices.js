// 사용자가 직접 확인해서 입력한 가격 (가장 우선)
import { readJsonFile, writeJsonFile } from './util.js';
import { parsePrice } from './pricing.js';

export function createUserPriceStore(file) {
  let data = file ? readJsonFile(file, {}) : {};
  const save = () => file && writeJsonFile(file, data);
  return {
    get: (id) => data[id] || null,
    all: () => data,
    set(id, { name = '', menu = '', price }) {
      const amount = parsePrice(price);
      if (!id || !amount) throw Object.assign(new Error('식당과 가격을 입력해 주세요.'), { status: 400 });
      data[id] = {
        name: String(name).slice(0, 100),
        menu: String(menu).slice(0, 100),
        price: amount,
        updatedAt: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }),
      };
      save();
      return data[id];
    },
    remove(id) {
      const existed = id in data;
      delete data[id];
      save();
      return existed;
    },
  };
}
