
export const $mobx = Symbol("mobx administration")

export const mobxDecoratorsSymbol = Symbol("mobx-decorators")

export const OBSERVABLE = "observable"


class Global {
    trackingDerivation: any
}
const _global = new Global() // 全局对象

class ObservableValue {

    observes: any[] = []
    value_: any // 属性值

    constructor(value: any) {
        this.value_ = value
    }

    get() {

        return this.value_
    }
    set(value: string) {
        //
        this.value_ = value
    }
}


class ObservableObjectAdministration {
    public values_ = new Map<PropertyKey, ObservableValue>() // 存储可观察对象集

    public target_:Object|null // 业务对象 就是我们常用的store

    constructor(target: Object|null) {
        this.target_ = target
    }

}


class  Reaction {

    onInvalidate_: (obj: Reaction) => void = () => null
    constructor(onInvalidate_:  () => void) {
        this.onInvalidate_ = onInvalidate_
    }
}


function observable(v: any, arg2?: any, arg3?: any) {

    // logger('createObservable', '参数1：v', v, arg2, arg3)
    console.log('createObservable', '参数1：v', v, '参数2：',arg2,'参数3：', arg3, 'isStringish(arg2)')
    // @observable someProp; // 处理装饰器模式
    if (typeof arg2 === 'string') {
        storeDecorator(v, arg2, OBSERVABLE)
        return
    }
    // 下边处理类似于  observable([]) observable({}) 等等  
}

// 给target对象添加一个
export function storeDecorator(
    target: any, // store
    property: PropertyKey, // key  a
    type: string, // “observable”
) {
  
    // 获取的属性描述信息
    const desc = Object.getOwnPropertyDescriptor(target, mobxDecoratorsSymbol)
    let map: any
    if (desc) {
        map = desc.value
    } else {
        map = {}
        // target[mobxDecoratorsSymbol] = {}
        Object.defineProperty(target, mobxDecoratorsSymbol, {
            enumerable: false,
            writable: true,
            configurable: true,
            value: map
        })
    }
    console.log('添加symbol属性', map, target)
    map[property] = { annotationType_: type }
    // store = {
    //     a: 1,
    //     Symbol(''): {
    //         a: { annotationType_: type }
    //     }
    // }

}



class Store {

    @observable
    a = 1
    constructor() {
        // makeObservable(this)
    }
}



export const store = new Store()
