
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

    public target_:Object|null // 业务对象

    constructor(target: Object|null) {
        this.target_ = target
    }
     // 创建可观察属性
     //  a    1
     public addObservableProp_(propName: string, value: any) {
         const { target_: target } = this

        // 创建可观察属性
        const observable = new ObservableValue(value)
        this.values_.set(propName, observable)



        // 修改业务对象可观察属性的元属性，劫持它的get 和set
        Object.defineProperty(target, propName, {
            configurable: true,
            enumerable: true,
            get() {
                return this[$mobx].read_(propName)
            },
            set(v) {
                this[$mobx].write_(propName, v)
            }
        })
     }


     read_(key: string) {
        
        return this.values_.get(key)!.get()
     }

     write_(key: string, value: any) {
        const observable = this.values_.get(key)
        // observable!.setNewValue_(value)
     }

     

     // 删除属性
     public remove_(propName: string) {
        // TODO
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


export function makeProperty(adm: ObservableObjectAdministration, target: any, key: string, annotation: any, descriptor?: PropertyDescriptor) {
    console.log('makeProperty', key, annotation)
    if(annotation.annotationType_ === OBSERVABLE)  {
         adm.addObservableProp_(key, descriptor?.value)
    }

}


function makeObservable( target: any ) {
    const adm = new ObservableObjectAdministration(target)
    console.log('makeObservable')
    // 这里建立了业务对象和admin对象的联系
    Object.defineProperty(target, $mobx, { 
        enumerable: false,
        writable: true,
        configurable: true,
        value: adm
    })
    let desc = null
     // 处理Observable属性 // 这时候target已经是实例store了 Object.getPrototypeOf(target)在查找原型，因为
     // mobxDecoratorsSymbol 放在了原型Store上了
    if(target && Object.getPrototypeOf(target)) {
        desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target),mobxDecoratorsSymbol )
    }
   /*
            {
                a: {annotationType_: "observable"}
                setA: {annotationType_: "action"}
                b:
                c:
            }
   */
    const annotations = desc?.value
    const make = (key: string) => {
            let annotation = annotations[key]
            // Object.getOwnPropertyDescriptor  store    a
            const desc = Object.getOwnPropertyDescriptor(target, key)
            makeProperty(adm, target, key,  annotation, desc)
        }
    if(annotations) {
        Object.getOwnPropertyNames(annotations).forEach(make)
    }

    console.log('makeObservable执行完成',target )
    


}




class Store {

    @observable
    a = 1
    constructor() {
        makeObservable(this)
    }
}



export const store = new Store()
console.log(Store, 'store')

/*

TODO list
现在被观察者已经有了， 接下来开发一个观察者。 这里这里暂不考虑ui观察者，所以暂时开发一个

1. autorun封装   autorun( fn )

    a.为autorun创建一个代理对象Reaction 并且将回调函数作为信息记录下来方便后边使用
      const reaction = new Reaction(
            function (this: Reaction) {
                              
                         },
    )
   
    b. 将fn封装一下，方便统一处理 (下边思路主要还是要沿着源码进行的，并未完全脱离源码，所以重点分析了一下为什么远么要这么做)
    const reaction = new Reaction(
            function (this: Reaction) {
                 // reaction的track是什么， 为什么不是直接执行而是放在track中呢 这里为什么放在reaction的track中呢？
                 // 因为track是负责收集依赖的处理函数，也就是说我们不仅要调用一下，而且在每次调用的时候重新收集一次依赖
                    this.track(reactionRunner) 
            },
    )
    function reactionRunner() {
        view(reaction)
    }

    c. 执行一次调度
        reaction.schedule_() // 这也就是为什么autorun会自动调用一次
    
2. Reaction
a. 存储一下回调函数 onInvalidate_: (obj: Reaction) => void = () => null
b. 收集依赖关系
这里为了打通 观察者reaction 与被观察者 observable之间的联系，需要借助于一个第三方对象，并且保证每次执行期间不能被打断，一般是放在一个
事务中的，暂时不体现事物的代码，大概如下
  track(fn: () => void) {
        _global.trackingDerivation = this // 也就是当前的执行上下文是在当前这个Reaction ，要知道一个observable可能是有
        // 多个reaction的，所以这两个是不可以乱的

        fn() // 执行一次fn，因为只有执行一次才可以知道当前的reaction依赖了哪些observable  比如： store.a store.b等等

        bindDependencies(this) // 执行过程中会将observable放在一个数组中，这个函数负责建立关联
    }
   
3. 上边2提到了依赖收集，也就是在执行store.a  => adm.read_('a') => amd.values_.get('a').get()  
a.在这个get中执行一个收集依赖的方法
    this.reportObserved() 紧接着调用一个工具函数reportObserved
b. 工具函数reportObserved 就是将当前observable对象放入到 当前执行上下文_global。trackingDerivation的一个观察数组中
也就是给Reaction添加一个observings: ObservableValue[] = []用来存放当前Reaction观察的对象，
这里对比一下ObservableValue 的observes: Reaction[]= [] 数组，可以看出两者是相互的， 为什么都要村一次呢， 
是因为两者是多对多关系， 多对多关系必须分别存储
eg    

    autorun(() => console.log( store.a, store.b, store.c )) ----1
    autorun(() => console.log( store.a, store.c )) ----2
    autorun(() => console.log(  store.b, store.c )) ---3

    这里有三个Reaction 有三个observable  

    -----------------------------------reaction
    Reaction1 = {
        observes: [a, b, c]
    }
     Reaction2 = {
        observes: [a, c]
    }
     Reaction3 = {
        observes: [ b, c]
    }


   -----------------------observableValue

    ObservableValue-a = {
        observes: [Reaction 1, Reaction 2]
    }
     ObservableValue-b = {
        observes: [Reaction 1, Reaction 3]
    }
     ObservableValue-c = {
        observes: [Reaction 1, Reaction 2, Reaction 3]
    }
    
    
    4. bindDependencies 这个函数就是将已经上边reaction 状态的值，转成observableValue
    这时


*/
