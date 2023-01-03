import {
    CaughtException,
    IDerivation,
    IDerivationState_,
    IEqualsComparer,
    IObservable,
    Lambda,
    TraceMode,
    autorun,
    clearObserving,
    comparer,
    createAction,
    createInstanceofPredicate,
    endBatch,
    getNextId,
    globalState,
    isCaughtException,
    isSpyEnabled,
    propagateChangeConfirmed,
    propagateMaybeChanged,
    reportObserved,
    shouldCompute,
    spyReport,
    startBatch,
    toPrimitive,
    trackDerivedFunction,
    untrackedEnd,
    untrackedStart,
    UPDATE,
    die,
    allowStateChangesStart,
    allowStateChangesEnd,
} from '../internal';

export interface IComputedValue<T> {
    get(): T;
    set(value: T): void;
    observe_(listener: (change: IComputedDidChange<T>) => void, fireImmediately?: boolean): Lambda;
}

export interface IComputedValueOptions<T> {
    get?: () => T;
    set?: (value: T) => void;
    name?: string;
    equals?: IEqualsComparer<T>;
    context?: any;
    requiresReaction?: boolean;
    keepAlive?: boolean;
}

export type IComputedDidChange<T = any> = {
    type: 'update';
    observableKind: 'computed';
    object: unknown;
    debugObjectName: string;
    newValue: T;
    oldValue: T | undefined;
};

/**
 * A node in the state dependency root that observes other nodes, and can be observed itself.
 *
 * ComputedValue will remember the result of the computation for the duration of the batch, or
 * while being observed.
 *
 * During this time it will recompute only when one of its direct dependencies changed,
 * but only when it is being accessed with `ComputedValue.get()`.
 *
 * Implementation description:
 * 1. First time it's being accessed it will compute and remember result
 *    give back remembered result until 2. happens
 * 2. First time any deep dependency change, propagate POSSIBLY_STALE to all observers, wait for 3.
 * 3. When it's being accessed, recompute if any shallow dependency changed.
 *    if result changed: propagate STALE to all observers, that were POSSIBLY_STALE from the last step.
 *    go to step 2. either way
 *
 * If at any point it's outside batch and it isn't observed: reset everything and go to 1.
 * 
 * 状态依赖根中的一个节点，它可以观察其他节点，也可以观察自身。
 *  ComputedValue将在批处理期间记住计算的结果，或者同时被观察。
 ＊ 
 * 在这段时间内，当它被'ComputedValue.get()'访问时。它的一个直接依赖发生变化时，它才会重新计算。
 *
 * 实现说明:
 *  1。第一次被访问时，它会计算并记住结果返回所记得的结果直到2发生
 *  2。第一次发生任何深度依赖更改时，将 POSSIBLY_STALE 传播到所有的观察者，等待3
 *  3。当它被访问时，如果任何浅依赖发生变化，则重新计算。
 * 如果结果改变:传播STALE到所有的观察者，从最后一步是POSSIBLY_STALE。 (可能过期)
 * 无论哪种方式转到步骤2。
   如果在任何时候它在批处理之外，它没有被观察到:重置所有东西，并转到1。
 */
/**
 * IObservable  IDerivation
 */
export class ComputedValue<T> implements IObservable, IComputedValue<T>, IDerivation {
    /**
     * dependenciesState   Reaction 类, 响应者的状态属性
     * lowestObserverState  IObservable 类，被观察者的状态属性
     * ComputedValue同时拥有dependenciesState、lowestObserverState两个属性
     *  因为它有时候充当被观察者，有时候充当响应
     */
    // Reaction
    dependenciesState_ = IDerivationState_.NOT_TRACKING_;
    // 这个是观察者R拥有的, 存储当前依赖 OV(Observable)
    // 数组收集依赖
    observing_: IObservable[] = []; // nodes we are looking at. Our value depends on these nodes
    // 过程中收集依赖数组
    newObserving_ = null; // during tracking it's an array with new observed observers

    isBeingObserved_ = false;
    isPendingUnobservation_: boolean = false;

    // 这个是被观察者拥有的, 存储调用当前属性的 Reaction
    observers_ = new Set<IDerivation>(); // 收集所有依赖 IDerivation (里面的obseverbale computed 等)
    lowestObserverState_ = IDerivationState_.UP_TO_DATE_;

    diffValue_ = 0;
    runId_ = 0;
    lastAccessedBy_ = 0;

    unboundDepsCount_ = 0; // 依赖计数
    mapid_ = '#' + getNextId();
    protected value_: T | undefined | CaughtException = new CaughtException(null);
    name_: string;
    triggeredBy_?: string;
    isComputing_: boolean = false; // to check for cycles
    isRunningSetter_: boolean = false;
    derivation: () => T; // N.B: unminified as it is used by MST
    setter_?: (value: T) => void;
    isTracing_: TraceMode = TraceMode.NONE;
    scope_: Object | undefined;
    private equals_: IEqualsComparer<any>;
    private requiresReaction_: boolean;
    keepAlive_: boolean;

    /**
     * Create a new computed value based on a function expression.
     *
     * The `name` property is for debug purposes only.
     *
     * The `equals` property specifies the comparer function to use to determine if a newly produced
     * value differs from the previous value. Two comparers are provided in the library; `defaultComparer`
     * compares based on identity comparison (===), and `structualComparer` deeply compares the structure.
     * Structural comparison can be convenient if you always produce a new aggregated object and
     * don't want to notify observers if it is structurally the same.
     * This is useful for working with vectors, mouse coordinates etc.
     */
    constructor(options: IComputedValueOptions<T>) {
        if (!options.get) die(31);
        // 上下文store get xxx
        this.derivation = options.get!;
        this.name_ = options.name || 'ComputedValue@' + getNextId();
        // 将 set 包装为一个 action
        if (options.set) this.setter_ = createAction(this.name_ + '-setter', options.set) as any;
        //
        /**
         * 对比新旧函数
         * 默认值: comparer.default, 它充当比较前一个值和后一个值的比较函数
         * 如果这个函数认为前一个值和后一个值是相等的, 观察者就不会重新评估, 在使用结构数据和来自其他库的类型时很有用
         * 例如: 一个computed 的 moment 实例可以使用 (a, b) => a.isSame(b),
         *      如果想要使用结构比较来确定新的值是否与上个值不同 (并作为结果通知观察者), comparer.struct 十分便利
         */
        this.equals_ =
            options.equals ||
            ((options as any).compareStructural || (options as any).struct
                ? comparer.structural // deepEqual(a, b) 深对比
                : comparer.default); // Object.is(a, b) 浅对比
        // 上下文 store (this)
        this.scope_ = options.context;
        // 对于非常昂贵的计算值, 推荐设置成 true
        // 如果你尝试读取它的值, 但某些观察者没有跟踪该值 (在这种情况下, mobx 不会缓存该值),
        // 则会导致计算结果丢失, 而不是进行昂贵的重新评估
        this.requiresReaction_ = !!options.requiresReaction;
        // 长期保持联系依赖?
        this.keepAlive_ = !!options.keepAlive;
    }

    // 作为 Reaction 加入处理列表, 等待 batch 结束统一再次处理一遍 Reaction ?
    // ComputedValue这里多了:
    // 会改变计算属性作为 Observable 的状态为 POSSIBLY_STALE_, 改变计算属性的Derivation的状态为 POSSIBLY_STALE_
    onBecomeStale_() {
        console.log('@computed onBecomeStale_');
        propagateMaybeChanged(this);
    }

    public onBOL: Set<Lambda> | undefined;
    public onBUOL: Set<Lambda> | undefined;

    public onBO() {
        if (this.onBOL) {
            this.onBOL.forEach(listener => listener());
        }
    }

    public onBUO() {
        if (this.onBUOL) {
            this.onBUOL.forEach(listener => listener());
        }
    }

    /**
     * Returns the current value of this computed value.
     * Will evaluate its computation first if needed.
     */
    public get(): T {
        // 是否循环依赖
        if (this.isComputing_) die(32, this.name_, this.derivation);

        console.log(
            'computed value Object',
            ' globalState.inBatch',
            globalState.inBatch,
            'this.observers_.size',
            this.observers_.size,
            'this.keepAlive_',
            this.keepAlive_,
            'shouldCompute(this)',
            shouldCompute(this)
        );
        // 无副作用事务
        if (
            globalState.inBatch === 0 &&
            // !globalState.trackingDerivatpion &&
            this.observers_.size === 0 &&
            !this.keepAlive_
        ) {
            if (shouldCompute(this)) {
                // 未追踪读取警告
                this.warnAboutUntrackedRead_();
                startBatch(); // See perf test 'computed memoization'
                // 简单执行计算 函数
                this.value_ = this.computeValue_(false);
                endBatch();
            }
        } else {
            // 被观察者ComputedValue加入 Reaction.newObserving，之后会建立起计算属性与observing其绑定关系
            reportObserved(this);
            // 是否计算
            if (shouldCompute(this)) {
                let prevTrackingContext = globalState.trackingContext;
                if (this.keepAlive_ && !prevTrackingContext) globalState.trackingContext = this;
                // trackAndCompute => boolean 是否变化值, 依赖追踪
                if (this.trackAndCompute()) {
                    // 改变观察者 & 被观察者 的状态
                    // 将观察者的 dependenciesState 变更为 STALE_，表示依赖项发生变化
                    propagateChangeConfirmed(this);
                }
                globalState.trackingContext = prevTrackingContext;
            }
        }
        const result = this.value_!;

        if (isCaughtException(result)) throw result.cause;
        return result;
    }

    public set(value: T) {
        if (this.setter_) {
            if (this.isRunningSetter_) die(33, this.name_);
            this.isRunningSetter_ = true;
            try {
                this.setter_.call(this.scope_, value);
            } finally {
                this.isRunningSetter_ = false;
            }
        } else die(34, this.name_);
    }

    // 执行回调函数, 完成依赖收集, 判断新值和旧值有没有变化
    trackAndCompute(): boolean {
        // N.B: unminified as it is used by MST
        const oldValue = this.value_;
        const wasSuspended =
            /* see #1208 */ this.dependenciesState_ === IDerivationState_.NOT_TRACKING_;
        const newValue = this.computeValue_(true);

        // if (window.__DEV__ && isSpyEnabled()) {
        //     spyReport({
        //         observableKind: 'computed',
        //         debugObjectName: this.name_,
        //         object: this.scope_,
        //         type: 'update',
        //         oldValue: this.value_,
        //         newValue,
        //     } as IComputedDidChange);
        // }

        const changed =
            wasSuspended ||
            isCaughtException(oldValue) ||
            isCaughtException(newValue) ||
            !this.equals_(oldValue, newValue);

        if (changed) {
            this.value_ = newValue;
        }

        return changed;
    }

    // 返回 compute 结果
    computeValue_(track: boolean) {
        this.isComputing_ = true;
        // don't allow state changes during computation
        // 不允许在计算过程中改变状态
        const prev = allowStateChangesStart(false);
        let res: T | CaughtException;
        // derivation 其实是传入的原class成员的get
        if (track) {
            // 调用trackDerivedFunction计算
            // trackDerivedFunction 执行回调, 更新追踪依赖关系、处理状态等
            res = trackDerivedFunction(this, this.derivation, this.scope_);
        } else {
            // this.derivation.call(this.scope_) => 简单 computed的回调计算
            if (globalState.disableErrorBoundaries === true) {
                res = this.derivation.call(this.scope_);
            } else {
                try {
                    res = this.derivation.call(this.scope_);
                } catch (e) {
                    res = new CaughtException(e);
                }
            }
        }
        allowStateChangesEnd(prev);
        this.isComputing_ = false;
        return res;
    }

    suspend_() {
        if (!this.keepAlive_) {
            clearObserving(this);
            this.value_ = undefined; // don't hold on to computed value!
        }
    }

    observe_(listener: (change: IComputedDidChange<T>) => void, fireImmediately?: boolean): Lambda {
        let firstTime = true;
        let prevValue: T | undefined = undefined;
        return autorun(() => {
            // TODO: why is this in a different place than the spyReport() function? in all other observables it's called in the same place
            let newValue = this.get();
            if (!firstTime || fireImmediately) {
                const prevU = untrackedStart();
                listener({
                    observableKind: 'computed',
                    debugObjectName: this.name_,
                    type: UPDATE,
                    object: this,
                    newValue,
                    oldValue: prevValue,
                });
                untrackedEnd(prevU);
            }
            firstTime = false;
            prevValue = newValue;
        });
    }

    warnAboutUntrackedRead_() {
        if (!window.__DEV__) return;
        if (this.requiresReaction_ === true) {
            die(`[mobx] Computed value ${this.name_} is read outside a reactive context`);
        }
        if (this.isTracing_ !== TraceMode.NONE) {
            console.log(
                `[mobx.trace] '${this.name_}' is being read outside a reactive context. Doing a full recompute`
            );
        }
        if (globalState.computedRequiresReaction) {
            console.warn(
                `[mobx] Computed value ${this.name_} is being read outside a reactive context. Doing a full recompute`
            );
        }
    }

    toString() {
        return `${this.name_}[${this.derivation.toString()}]`;
    }

    valueOf(): T {
        return toPrimitive(this.get());
    }

    [Symbol.toPrimitive]() {
        return this.valueOf();
    }
}

export const isComputedValue = createInstanceofPredicate('ComputedValue', ComputedValue);
