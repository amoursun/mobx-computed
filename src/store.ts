import { observable, action, computed, makeObservable } from './mobx-base/mobx/internal';
import { BaseStore } from './base-store';

export interface StoreObject {
    amount: number;
    price: number;
    add: (type: OperateType) => void;
    reduce: (type: OperateType) => void;
    total: number;
}
type OperateType = 'amount' | 'price';

class Store extends BaseStore {
    constructor() {
        super();
        makeObservable(this);
    }

    @observable amount = 10;
    @observable price = 55;

    @action('add') add = (type: OperateType = 'amount') => {
        this[type] = this[type] + 1;
    };

    @action reduce = (type: OperateType) => {
        this[type] = this[type] - 1;
    };

    @computed get total() {
        return this.price * this.amount;
    }
    // @computed({ name: 'total' }) get total() {
    //     return this.price * this.amount;
    // }
}
export const store: StoreObject = new Store();
