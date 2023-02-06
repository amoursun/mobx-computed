

export const mobxDecoratorsSymbol = Symbol("mobx-decorators")

class Global {
    trackingDerivation: any
  

}


class ObservableValue {

    observes: any[] = []
    value_: any // 属性值
    

    constructor(value: any) {
        this.value_ = value
    }

    get() {
        //
        // this.reportObserved()
        console.log('get, ', this.value_)
        return this.value_
    }
    set(value: string) {
        // 

      
    }

}


class ObservableObjectAdministration {
    public values_ = new Map<PropertyKey, ObservableValue>() // 存储可观察对象集

    public target_:Object|null // 业务对象

    constructor(target: Object|null) {
        this.target_ = target
    }
     // 创建可观察属性
    //  public addObservableProp_(propName: string, value: any) {
    //      const { target_: target } = this

    //     // 创建可观察属性
    //     const observable = new ObservableValue(value)
    //     this.values_.set(propName, observable)
    //     // 修改业务对象可观察属性的元属性，劫持它的get 和set
    //     Object.defineProperty(target, propName, {
    //         configurable: true,
    //         enumerable: true,
    //         get() {
    //             return this[$mobx].read_(propName)
    //         },
    //         set(v) {
    //             this[$mobx].write_(propName, v)
    //         }
    //     })
    //  }


    //  read_(key: string) {
        
    //     return this.values_.get(key)!.get()
    //  }

    //  write_(key: string, value: any) {
    //     const observable = this.values_.get(key)
    //     observable!.setNewValue_(value)
    //  }

     

     // 删除属性
    //  public remove_(propName: string) {
    //     // TODO
    //  }

}


class  Reaction {

    // observings: any[] = []
    onInvalidate_: (obj: Reaction) => void = () => null
    constructor(onInvalidate_:  () => void) {
        this.onInvalidate_ = onInvalidate_
    }

    // onBecomeStale_() {
    //     this.schedule_()
    // }
    // schedule_ () {
    //     this.runReaction_()
    // }
    // runReaction_() {
    //    this.onInvalidate_(this)
    // }

    // track(fn: () => void) {
    //     _global.trackingDerivation = this
    //     // fn
    //     fn()

    //     bindDependencies(this)
    // }

}





// 给target对象添加一个
export function storeDecorator(
    target: any,
    property: PropertyKey,
    type: string,
) {
  

    const desc = Object.getOwnPropertyDescriptor(target, mobxDecoratorsSymbol)
    let map: any
    if (desc) {
        map = desc.value
    } else {
        map = {}
    
        Object.defineProperty(target, mobxDecoratorsSymbol, {
            enumerable: false,
            writable: true,
            configurable: true,
            value: map
        })
    }
    console.log('添加symbol属性', map, target)
    map[property] = { annotationType_: type }

}

function observable(v: any, arg2?: any, arg3?: any) {

    // logger('createObservable', '参数1：v', v, arg2, arg3)
    console.log('createObservable', '参数1：v', v, '参数2：',arg2,'参数3：', arg3, 'isStringish(arg2)')
    // @observable someProp;
    if (typeof arg2 === 'string') {
        storeDecorator(v, arg2, OBSERVABLE)
        return
    }
  
}


class Store {

    @observable
    a = 1
    constructor() {
        // makeObservable(this)
    }
}




































export default 1