import {
    asObservableObject,
    addHiddenProp,
    action,
    autoAction,
    isAction,
    computed,
    observable,
    AnnotationsMap,
    Annotation,
    getEnhancerFromAnnotation,
    endBatch,
    startBatch,
    CreateObservableOptions,
    ObservableObjectAdministration,
    applyDecorators,
    isObservableProp,
    getDescriptor,
    isPlainObject,
    isObservableObject,
    isFunction,
    die,
    ACTION,
    ACTION_BOUND,
    AUTOACTION,
    AUTOACTION_BOUND,
    COMPUTED,
    COMPUTED_STRUCT,
    OBSERVABLE,
    OBSERVABLE_REF,
    OBSERVABLE_SHALLOW,
    OBSERVABLE_STRUCT,
    getOwnPropertyDescriptors,
    defineProperty,
    ownKeys,
    objectPrototype,
    hasProp,
    FLOW,
    flow,
    isGenerator,
    isFlow,
} from '../internal';

const CACHED_ANNOTATIONS = Symbol('mobx-cached-annotations');

function makeAction(target, key, name, fn, asAutoAction) {
    addHiddenProp(
        target,
        key,
        asAutoAction ? autoAction(name || key, fn) : action(name || key, fn)
    );
}

function getInferredAnnotation(
    desc: PropertyDescriptor,
    defaultAnnotation: Annotation | undefined,
    autoBind: boolean
): Annotation | boolean {
    if (desc.get) return computed;
    if (desc.set) return false; // ignore pure setters
    // if already wrapped in action, don't do that another time, but assume it is already set up properly
    if (isFunction(desc.value))
        return isGenerator(desc.value)
            ? flow
            : isAction(desc.value)
            ? false
            : autoBind
            ? autoAction.bound
            : autoAction;
    // if (!desc.configurable || !desc.writable) return false
    return defaultAnnotation ?? observable.deep;
}

function getDescriptorInChain(target: Object, prop: PropertyKey): [PropertyDescriptor, Object] {
    let current = target;
    while (current && current !== objectPrototype) {
        // Optimization: cache meta data, especially for members from prototypes?
        const desc = getDescriptor(current, prop);
        if (desc) {
            return [desc, current];
        }
        current = Object.getPrototypeOf(current);
    }
    die(1, prop);
}

export function makeProperty(
    adm: ObservableObjectAdministration,
    owner: Object,
    key: PropertyKey,
    descriptor: PropertyDescriptor,
    annotation: Annotation | boolean,
    forceCopy: boolean, // extend observable will copy even unannotated properties
    autoBind: boolean
): void {
    const { target_: target } = adm;
    const defaultAnnotation: Annotation | undefined = observable; // ideally grap this from adm's defaultEnahncer instead!
    const origAnnotation = annotation;
    if (annotation === true) {
        annotation = getInferredAnnotation(descriptor, defaultAnnotation, autoBind);
    }
    if (annotation === false) {
        if (forceCopy) {
            defineProperty(target, key, descriptor);
        }
        return;
    }
    if (!annotation || annotation === true || !annotation.annotationType_) {
        return die(2, key);
    }
    const type = annotation.annotationType_;
    console.log('makeProperty调用-参数列表', {
        adm,
        owner,
        key,
        descriptor,
        annotation,
        forceCopy,
        autoBind,
        type,
    });
    switch (type) {
        case AUTOACTION:
        case ACTION: {
            const fn = descriptor.value;
            if (!isFunction(fn)) die(3, key);
            if (owner !== target && !forceCopy) {
                if (!isAction(owner[key]))
                    makeAction(owner, key, annotation.arg_, fn, type === AUTOACTION);
            } else {
                makeAction(target, key, annotation.arg_, fn, type === AUTOACTION);
            }
            break;
        }
        case AUTOACTION_BOUND:
        case ACTION_BOUND: {
            const fn = descriptor.value;
            if (!isFunction(fn)) die(3, key);
            makeAction(
                target,
                key,
                annotation.arg_,
                fn.bind(adm.proxy_ || target),
                type === AUTOACTION_BOUND
            );
            break;
        }
        case FLOW: {
            if (owner !== target && !forceCopy) {
                if (!isFlow(owner[key])) addHiddenProp(owner, key, flow(descriptor.value!));
            } else {
                addHiddenProp(target, key, flow(descriptor.value));
            }
            break;
        }
        case COMPUTED:
        case COMPUTED_STRUCT: {
            if (!descriptor.get) die(4, key);
            // 将Obsrvable 加到 adm values(Map) 上, 值的获取以及操作函数通过这里读取或设置
            adm.addComputedProp_(target, key, {
                get: descriptor.get,
                set: descriptor.set,
                compareStructural: annotation.annotationType_ === COMPUTED_STRUCT,
                ...annotation.arg_,
            });
            break;
        }
        case OBSERVABLE:
        case OBSERVABLE_REF:
        case OBSERVABLE_SHALLOW:
        case OBSERVABLE_STRUCT: {
            if (window.__DEV__ && isObservableProp(target, key as any))
                die(
                    `Cannot decorate '${key.toString()}': the property is already decorated as observable.`
                );
            if (window.__DEV__ && !('value' in descriptor))
                die(
                    `Cannot decorate '${key.toString()}': observable cannot be used on setter / getter properties.`
                );
            // if the origAnnotation was true, preferred the adm's default enhancer over the inferred one
            // enhancer 增强剂    enhancer 有多种，若用户不作额外配置，Mobx 里默认对每个 value 使用 deepEnhancer 进行包装，
            // 其实就是递归对这个 value 做 observable 命令式调用 的操作。
            const enhancer =
                origAnnotation === true
                    ? adm.defaultEnhancer_
                    : getEnhancerFromAnnotation(annotation);
            adm.addObservableProp_(key, descriptor.value, enhancer);
            break;
        }
        default:
            if (window.__DEV__)
                die(
                    `invalid decorator '${
                        annotation.annotationType_ ?? annotation
                    }' for '${key.toString()}'`
                );
    }
}

// Hack based on https://github.com/Microsoft/TypeScript/issues/14829#issuecomment-322267089
// We need this, because otherwise, AdditionalKeys is going to be inferred to be any
// set of superfluos keys. But, we rather want to get a compile error unless AdditionalKeys is
// _explicity_ passed as generic argument
// Fixes: https://github.com/mobxjs/mobx/issues/2325#issuecomment-691070022
type NoInfer<T> = [T][T extends any ? 0 : never];

export function makeObservable<T, AdditionalKeys extends PropertyKey = never>(
    target: T, // 需转化的目标实例对象
    annotations?: AnnotationsMap<T, NoInfer<AdditionalKeys>>, // 注解对象(标记 Symbol对象)
    options?: CreateObservableOptions
): T {
    const autoBind = !!options?.autoBind;
    console.log('makeObservable', '参数：target ', target, '参数annotations', annotations);
    // 这个看上去很重要， 要细细看
    const adm = asObservableObject(
        target,
        options?.name,
        getEnhancerFromAnnotation(options?.defaultDecorator)
    );
    startBatch();

    // target => makeObservable(this) 的this => store
    try {
        if (!annotations) {
            const didDecorate = applyDecorators(target);
            if (window.__DEV__ && !didDecorate)
                die(
                    `No annotations were passed to makeObservable, but no decorator members have been found either`
                );
            return target;
        }
        const make = key => {
            let annotation = annotations[key];
            const [desc, owner] = getDescriptorInChain(target, key);
            makeProperty(adm, owner, key, desc, annotation, false, autoBind);
        };
        ownKeys(annotations).forEach(make);
    } finally {
        endBatch();
    }
    return target;
}

export function makeAutoObservable<T extends Object, AdditionalKeys extends PropertyKey = never>(
    target: T,
    excludes?: AnnotationsMap<T, NoInfer<AdditionalKeys>>,
    options?: CreateObservableOptions
): T {
    const proto = Object.getPrototypeOf(target);
    const isPlain = proto == null || proto === objectPrototype;
    if (window.__DEV__) {
        if (!isPlain && !isPlainObject(proto))
            die(`'makeAutoObservable' can only be used for classes that don't have a superclass`);
        if (isObservableObject(target))
            die(`makeAutoObservable can only be used on objects not already made observable`);
    }
    let annotations: AnnotationsMap<any, any>;
    if (!isPlain && hasProp(proto, CACHED_ANNOTATIONS)) {
        // shortcut, reuse inferred annotations for this type from the previous time
        annotations = proto[CACHED_ANNOTATIONS] as any;
    } else {
        annotations = { ...excludes };
        extractAnnotationsFromObject(target, annotations, options);
        if (!isPlain) {
            extractAnnotationsFromProto(proto, annotations, options);
            addHiddenProp(proto, CACHED_ANNOTATIONS, annotations);
        }
    }
    makeObservable(target, annotations as any, options);
    return target;
}

function extractAnnotationsFromObject(
    target,
    collector: AnnotationsMap<any, any>,
    options: CreateObservableOptions | undefined
) {
    const autoBind = !!options?.autoBind;
    const defaultAnnotation: Annotation = options?.deep
        ? observable.deep
        : options?.defaultDecorator ?? observable.deep;
    Object.entries(getOwnPropertyDescriptors(target)).forEach(([key, descriptor]) => {
        if (key in collector || key === 'constructor') return;
        collector[key] = getInferredAnnotation(descriptor, defaultAnnotation, autoBind);
    });
}

function extractAnnotationsFromProto(
    proto: any,
    collector: AnnotationsMap<any, any>,
    options?: CreateObservableOptions
) {
    Object.entries(getOwnPropertyDescriptors(proto)).forEach(([key, prop]) => {
        if (key in collector || key === 'constructor') return;
        if (prop.get) {
            collector[key as any] = computed;
        } else if (isFunction(prop.value)) {
            collector[key as any] = isGenerator(prop.value)
                ? flow
                : options?.autoBind
                ? autoAction.bound
                : autoAction;
        }
    });
}
