



class Global {
   
}
const _global = new Global() // 全局对象

class ObservableValue {

    observes: Reaction[] = []
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
    addObservableProp_() {
        // 基于属性创建ObservableValue
    }

}


class  Reaction {

    onInvalidate_: (obj: Reaction) => void = () => null
    constructor(onInvalidate_:  () => void) {
        this.onInvalidate_ = onInvalidate_
    }
}




class Store {

   @observable
    a = 1
    constructor() {
        makeObservable(this)
    }
}


function makeObservable(target) {
    const adm = new ObservableObjectAdministration(target)
    Object.defineProperty(target,'123', {
        value: adm
    })

}


export const store = new Store()



/*
    TODO list

    01  实现  observable   将store的属性变成可观察属性
    需求分析
        a.将observable标记的属性记录下来, 这会儿还没有store的代理对象，所以暂时需要将这个信息挂载到store上
        将来这个挂在还要删掉
        b. 类似于observable的还有action computed 甚至observable.ref也就是说，这些信息属于不同的类别所以为了区分
        要给他们分类
        c.挂载的时候为了不和用户写的属性冲突，创建一个symbol
        目标长这样
        store = {
            a: 1
            Symbol(mobx-decorators): {
                a: {annotationType_: "observable"}
                setA: {annotationType_: "action"}
            }
        }


    02 实现   makeObservable  将store的可观察属性真正实现
    需求分析
        a.为业务对象store创建一个代理对象  ObservableObjectAdministration，并且建立业务对象和代理对象的互相挂在关系
        如下
        adm = {
            target: store
        }

        store = {
            Symbol(mobx administration): adm
        }

        b. 将前边收集的observable  action computed等等分类型的进行处理，这里暂时只考虑observable 

        c. adm作为大管家，需要负责根据  a: {annotationType_: "observable"} 创建出 a 的ObservableValue 对象并且针对
        业务对象的属性a 进行拦截,所以为adm添加一个处理函数

        adm = {

            addObservableProp_(propName: string, value: any) {
                创建  a 的ObservableValue

                new 的ObservableValue()

                this.values_[key] = ObservableValue

                将a 的ObservableValue存储下来放在 values_中

                拦截store.a
                

            }
        }


        d.  为observable的属性创建代理对象 ObservableValue 但是这个属性的代理对象统一归 ObservableObjectAdministration管理
        所以 adm对象需要添加一个管理属性的map 也就是  values_ = new Map<PropertyKey, ObservableValue>() // 存储可观察对象集
        这样处理完之后adm的样子就成了
        adm = {
            values_ : {
                a:  a 对应的ObservableValue
            }
        }
        这样后边  store.a  ==>  adm.values_.get('a') =>  a 对应的ObservableValue.get()




*/



















