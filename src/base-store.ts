import { observable, action, makeObservable } from './mobx-base/mobx/internal';

export class BaseStore {
    constructor() {
        makeObservable(this);
    }

    @observable data = 10;
    @action changeScore = (value: any) => {
        this.data = value;
    };
}
