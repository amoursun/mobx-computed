import { Reaction } from "./autorun";
import { global } from "./global"

export const store = {
    a: 0,

    increateA: function () {
        this.a = this.a + 1
        console.log(this.a, '打印a')
    }
}

export class ObservableObj<T> {
    value: T
    suitors: Reaction[] = []
    constructor(value: T) {
        this.value = value
    }
}

let a = new ObservableObj<number>(1)


Object.defineProperty(store, 'a', {

    get() {
        console.log('geta', this)
        // 记录下来调用者，方便后面使用
        global.trackingDerivation.observableObj.push(a)
        return a.value
    },

    set(val) {
        console.log('setA', val, a.suitors)
        a.value = val
        a.suitors.forEach((s) => {
            if(s && s.f) {
                s.f()
            }
        })
       
    }
} )


