import {
    Atom,
    IEnhancer,
    IInterceptable,
    IEqualsComparer,
    IInterceptor,
    IListenable,
    Lambda,
    checkIfStateModificationsAreAllowed,
    comparer,
    createInstanceofPredicate,
    getNextId,
    hasInterceptors,
    hasListeners,
    interceptChange,
    isSpyEnabled,
    notifyListeners,
    registerInterceptor,
    registerListener,
    spyReport,
    spyReportEnd,
    spyReportStart,
    toPrimitive,
    globalState,
    IUNCHANGED,
    UPDATE,
} from '../internal';

export interface IValueWillChange<T> {
    object: IObservableValue<T>;
    type: 'update';
    newValue: T;
}

export type IValueDidChange<T = any> = {
    type: 'update';
    observableKind: 'value';
    object: IObservableValue<T>;
    debugObjectName: string;
    newValue: unknown;
    oldValue: unknown;
};
export type IBoxDidChange<T = any> =
    | {
          type: 'create';
          observableKind: 'value';
          object: IObservableValue<T>;
          debugObjectName: string;
          newValue: unknown;
      }
    | IValueDidChange<T>;

export interface IObservableValue<T> {
    get(): T;
    set(value: T): void;
    intercept_(handler: IInterceptor<IValueWillChange<T>>): Lambda;
    observe_(listener: (change: IValueDidChange<T>) => void, fireImmediately?: boolean): Lambda;
}

const CREATE = 'create';

export class ObservableValue<T>
    extends Atom
    implements IObservableValue<T>, IInterceptable<IValueWillChange<T>>, IListenable
{
    hasUnreportedChange_ = false;
    interceptors_;
    changeListeners_;
    value_;
    dehancer: any;

    constructor(
        value: T,
        public enhancer: IEnhancer<T>,
        public name_ = 'ObservableValue@' + getNextId(),
        notifySpy = true,
        private equals: IEqualsComparer<any> = comparer.default
    ) {
        super(name_);
        this.value_ = enhancer(value, undefined, name_);
        if (window.__DEV__ && notifySpy && isSpyEnabled()) {
            // only notify spy if this is a stand-alone observable
            spyReport({
                type: CREATE,
                object: this,
                observableKind: 'value',
                debugObjectName: this.name_,
                newValue: '' + this.value_,
            });
        }
    }

    private dehanceValue(value: T): T {
        if (this.dehancer !== undefined) return this.dehancer(value);
        return value;
    }

    public set(newValue: T) {
        const oldValue = this.value_;
        newValue = this.prepareNewValue_(newValue) as any;
        if (newValue !== globalState.UNCHANGED) {
            // const notifySpy = isSpyEnabled();
            // if (window.__DEV__ && notifySpy) {
            //     spyReportStart({
            //         type: UPDATE,
            //         object: this,
            //         observableKind: 'value',
            //         debugObjectName: this.name_,
            //         newValue,
            //         oldValue,
            //     });
            // }
            this.setNewValue_(newValue);
            // if (window.__DEV__ && notifySpy) spyReportEnd();
        }
    }

    private prepareNewValue_(newValue): T | IUNCHANGED {
        checkIfStateModificationsAreAllowed(this);
        if (hasInterceptors(this)) {
            // TODO:这里不知道Interceptors是什么
            const change = interceptChange<IValueWillChange<T>>(this, {
                object: this,
                type: UPDATE,
                newValue,
            });
            if (!change) return globalState.UNCHANGED;
            newValue = change.newValue;
        }
        // apply modifier
        /*
            eg  store.a = { name: 'Yuu' }
            store.a.name = 'Yo' // 这是场景1
            store.a = {name: 'Yo'} // 这是场景2，
            store.a = {age: 1} // 这是场景3

            对于场景2，3来看属于直接覆盖了原来的对象， 所以这里的处理直接通过enhancer
            比较暴力的重建了一个新的adm对象，抛弃原来的adm， 后边的equals当然就返回false

            对于场景1这个不属于当前属性因为当前的ObservableValue是a这个属性的代理人，也就是说
            这里是对 store.a 的get 和set进行的管理，那么场景1 这个是对name的赋值，也就不会触发当前
            对象的set方法， 这也就是为什么对于object，array，map，set这些类型需要进行deepEnhance的
            原因，这样将会触发更深层的set方法。详见enhancer方法实现



            补充： 对于observable其实默认的就是observable.deep对应的也就是deepEnhancer也就是会
            实现deep观察， 所以即便是对于场景1这种情形，也是能够cover住的
                然而，对于observable.ref 这个api意思是refrence也就是观察的引用换句话说只会对引用关系
                尽心观察，如果引用关系没有变化那么就无法观察到，说白了就是这个enhancer用的是
                export function referenceEnhancer(newValue?) {
                        // never turn into an observable
                        return newValue
                }
                就是啥都没干。。。。那么也就是纯靠  this.equals进行对比， 所以如果场景1这样引用关系
                没变化的话，就不会有影响， 2，,3这样的引用关系变了，也会触发更新
                


        */
        newValue = this.enhancer(newValue, this.value_, this.name_);
        return this.equals(this.value_, newValue) ? globalState.UNCHANGED : newValue;
    }

    setNewValue_(newValue: T) {
        const oldValue = this.value_;
        this.value_ = newValue;
        // 通知变化, 调用OV.oberservers_ 调用Reaction.onBecomeStale_
        this.reportChanged();
        if (hasListeners(this)) {
            notifyListeners(this, {
                type: UPDATE,
                object: this,
                newValue,
                oldValue,
            });
        }
    }

    public get(): T {
        this.reportObserved();
        return this.dehanceValue(this.value_);
    }

    intercept_(handler: IInterceptor<IValueWillChange<T>>): Lambda {
        return registerInterceptor(this, handler);
    }

    observe_(listener: (change: IValueDidChange<T>) => void, fireImmediately?: boolean): Lambda {
        if (fireImmediately)
            listener({
                observableKind: 'value',
                debugObjectName: this.name_,
                object: this,
                type: UPDATE,
                newValue: this.value_,
                oldValue: undefined,
            });
        return registerListener(this, listener);
    }

    raw() {
        // used by MST ot get undehanced value
        return this.value_;
    }

    toJSON() {
        return this.get();
    }

    toString() {
        return `${this.name_}[${this.value_}]`;
    }

    valueOf(): T {
        return toPrimitive(this.get());
    }

    [Symbol.toPrimitive]() {
        return this.valueOf();
    }
}

export const isObservableValue = createInstanceofPredicate('ObservableValue', ObservableValue) as (
    x: any
) => x is IObservableValue<any>;
