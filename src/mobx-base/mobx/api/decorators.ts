import {
    Annotation,
    addHiddenProp,
    AnnotationsMap,
    makeObservable,
    assign,
    getDescriptor,
    hasProp,
    objectPrototype
} from "../internal"

export const mobxDecoratorsSymbol = Symbol("mobx-decorators")
const mobxAppliedDecoratorsSymbol = Symbol("mobx-applied-decorators")

export function createDecorator<ArgType>(
    type: Annotation["annotationType_"]
): Annotation & PropertyDecorator & ((arg: ArgType) => PropertyDecorator & Annotation) {
    return assign(
        function (target: any, property?: PropertyKey): any {
            if (property === undefined) {
                // @decorator(arg) member
                createDecoratorAndAnnotation(type, target)
            } else {
                // @decorator member
                storeDecorator(target, property!, type)
            }
        },
        {
            annotationType_: type
        }
    ) as any
}

export function createDecoratorAndAnnotation(
    type: Annotation["annotationType_"],
    arg_?: any
): PropertyDecorator & Annotation {
    return assign(
        function (target, property) {
            storeDecorator(target, property, type, arg_)
        },
        {
            annotationType_: type,
            arg_
        }
    )
}

export function storeDecorator(
    target: any,
    property: PropertyKey,
    type: Annotation["annotationType_"],
    arg_?: any
) {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getOwnPropertyDescriptor
    // getDescriptor = Object.getOwnPropertyDescriptor
    const desc = getDescriptor(target, mobxDecoratorsSymbol)
   
    let map: any
    if (desc) {
        map = desc.value
    } else {
        map = {}
        // 这个方法给target上添加了一个不可枚举的symbol的属性值是map
        addHiddenProp(target, mobxDecoratorsSymbol, map)
    }
    map[property] = { annotationType_: type, arg_ } as Annotation

     console.log('storeDecorator', '给target对象添加一个不可枚举的map属性', target, type, map)
}

/*

const object1 = {
  property1: 42
};
const descriptor1 = Object.getOwnPropertyDescriptor(object1, 'property1');
console.log(descriptor1.configurable);
// expected output: true

console.log(descriptor1.value);
// expected output: 42

*/
export function applyDecorators(target: Object): boolean {
    if (target[mobxAppliedDecoratorsSymbol]) return true
    let current = target
    // optimization: this could be cached per prototype!
    // (then we can remove the weird short circuiting as well..)
    let annotations: AnnotationsMap<any, any>[] = []
    // 这个while是递归的，意思是一直递归到原生Object的property  这是想干啥？？？
    // 也就是说如果    A  extends B  extends C extends D 这样如果 makeObservable(A)那么BCD也被执行了一下这个方法
    while (current && current !== objectPrototype) {
        // 这里要与这个函数export function storeDecorator呼应， 前边给放了这样一个属性，并且把被observable的属性放在这个map中了
        const desc = getDescriptor(current, mobxDecoratorsSymbol)
        if (desc) {
            if (!annotations.length) {
                for (let key in desc.value) {
                    // second conditions is to recognize actions
                    if (!hasProp(target, key) && !hasProp(current, key)) {
                        // not all fields are defined yet, so we are in the makeObservable call of some super class,
                        // short circuit, here, we will do this again in a later makeObservable call
                        return true
                    }
                }
            }
            annotations.unshift(desc.value) // 这样放进入的事前边的map对象，其key是被observable的对象
        }
        current = Object.getPrototypeOf(current)
    }
    annotations.forEach(a => {
        console.log('applyDecorators, 这是applyDecorators中的forEach',  a, target)
        makeObservable(target, a)
    })
    addHiddenProp(target, mobxAppliedDecoratorsSymbol, true)
    return annotations.length > 0
}
