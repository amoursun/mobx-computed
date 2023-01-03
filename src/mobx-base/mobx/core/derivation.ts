import {
    IAtom,
    IDepTreeNode,
    IObservable,
    addObserver,
    globalState,
    isComputedValue,
    removeObserver,
} from '../internal';

/*
状态机设计原理：
初始都是 NOT_TRACKING，绑定起依赖和派生关系后集体变为 U_T_D。解绑则回退为 NOT_TRACKING。

某收集的依赖发生变化时，其自身依赖状态和 Derivation (onBecomeStale后)都变为 STALE。
在 Derivation 重新处理后，其自身和收集的依赖都变为 U_T_D。

计算属性计算后（含第一次），自身派生状态、收集的依赖状态都变为 U_T_D。
（符合 2 第二句 Derivation 重新处理后，其自身和收集的依赖都变为 U_T_D）在第一次被绑定后，符合 1。

若计算属性收集的某依赖 A 状态发生变化时，将 A 状态和 计算属性派生状态(onBecomeStale后) 为 STALE（符合 2 第一句），
并且把 计算属性依赖状态、计算属性派生的 Derivation 置为 P_STALE（区别）。在计算属性重新计算后自身派生状态、收集的所有依赖状态变更为 U_T_D（符合 2 第二句），若计算结果无变更，把计算属性依赖状态、计算属性派生的 Derivation 变回 U_T_D 。若有变更，则把 计算属性派生的 Derivation 变为 STALE，接着重新处理 计算属性派生的 Derivation，把其和其收集的依赖（含计算属性作为依赖）状态 变为 U_P_D。



*/
export enum IDerivationState_ {
    // before being run or (outside batch and not being observed)
    // at this point derivation is not holding any data about dependency tree
    NOT_TRACKING_ = -1, // 在执行之前，或事务之外，或未被观察(计算值)时，所处的状态。此时 Derivation 没有任何关于依赖树的信息。枚举值-1
    // no shallow dependency changed since last computation
    // won't recalculate derivation
    // this is what makes mobx fast
    UP_TO_DATE_ = 0, // 表示所有依赖都是最新的，这种状态下不会重新计算。枚举值0
    // some deep dependency changed, but don't know if shallow dependency changed
    // will require to check first if UP_TO_DATE or POSSIBLY_STALE
    // currently only ComputedValue will propagate POSSIBLY_STALE
    //
    // having this state is second big optimization:
    // don't have to recompute on every dependency change, but only when it's needed
    POSSIBLY_STALE_ = 1, // 计算值才有的状态，表示深依赖发生了变化，但不能确定浅依赖是否变化，在重新计算之前会检查。枚举值1
    // A shallow dependency has changed since last computation and the derivation
    // will need to recompute when it's needed next.
    STALE_ = 2, // 过期状态，即浅依赖发生了变化，Derivation 需要重新计算。枚举值2
}

export enum TraceMode {
    NONE,
    LOG,
    BREAK,
}

/**
 * A derivation is everything that can be derived from the state (all the atoms) in a pure manner.
 * See https://medium.com/@mweststrate/becoming-fully-reactive-an-in-depth-explanation-of-mobservable-55995262a254#.xvbh6qd74
 */
export interface IDerivation extends IDepTreeNode {
    observing_: IObservable[]; // 依赖数组
    newObserving_: null | IObservable[]; // 每次执行收集到的新依赖数组
    dependenciesState_: IDerivationState_; // 依赖的状态
    /**
     * Id of the current run of a derivation. Each time the derivation is tracked
     * this number is increased by one. This number is globally unique
     */
    runId_: number; // 每次执行都会有一个 uuid，配合 Observable 的 lastAccessedBy 属性做简单的性能优化
    /**
     * amount of dependencies used by the derivation in this run, which has not been bound yet.
     */
    unboundDepsCount_: number; // 执行时新收集的未绑定依赖数量
    mapid_: string;
    onBecomeStale_(): void; // 依赖过期时执行
    isTracing_: TraceMode;

    /**
     *  warn if the derivation has no dependencies after creation/update
     */
    requiresObservable_?: boolean;
}

export class CaughtException {
    constructor(public cause: any) {
        // Empty
    }
}

export function isCaughtException(e: any): e is CaughtException {
    return e instanceof CaughtException;
}

/**
 * Finds out whether any dependency of the derivation has actually changed.
 * If dependenciesState is 1 then it will recalculate dependencies,
 * if any dependency changed it will propagate it by changing dependenciesState to 2.
 *
 * By iterating over the dependencies in the same order that they were reported and
 * stopping on the first change, all the recalculations are only called for ComputedValues
 * that will be tracked by derivation. That is because we assume that if the first x
 * dependencies of the derivation doesn't change then the derivation should run the same way
 * up until accessing x-th dependency.
 */
export function shouldCompute(derivation: IDerivation): boolean {
    switch (derivation.dependenciesState_) {
        case IDerivationState_.UP_TO_DATE_:
            return false;
        case IDerivationState_.NOT_TRACKING_:
        case IDerivationState_.STALE_:
            return true;
        case IDerivationState_.POSSIBLY_STALE_: {
            // state propagation can occur outside of action/reactive context #2195
            const prevAllowStateReads = allowStateReadsStart(true);
            const prevUntracked = untrackedStart(); // no need for those computeds to be reported, they will be picked up in trackDerivedFunction.
            const obs = derivation.observing_,
                l = obs.length;
            for (let i = 0; i < l; i++) {
                const obj = obs[i];
                if (isComputedValue(obj)) {
                    if (globalState.disableErrorBoundaries) {
                        obj.get();
                    } else {
                        try {
                            obj.get();
                        } catch (e) {
                            // we are not interested in the value *or* exception at this moment, but if there is one, notify all
                            untrackedEnd(prevUntracked);
                            allowStateReadsEnd(prevAllowStateReads);
                            return true;
                        }
                    }
                    // if ComputedValue `obj` actually changed it will be computed and propagated to its observers.
                    // and `derivation` is an observer of `obj`
                    // invariantShouldCompute(derivation)
                    if ((derivation.dependenciesState_ as any) === IDerivationState_.STALE_) {
                        untrackedEnd(prevUntracked);
                        allowStateReadsEnd(prevAllowStateReads);
                        return true;
                    }
                }
            }
            // 如果重新计算值没有变化, 则重置derivation与计算属性作为依赖的状态为 UP_TO_DATE_
            changeDependenciesStateTo0(derivation);
            untrackedEnd(prevUntracked);
            allowStateReadsEnd(prevAllowStateReads);
            return false;
        }
    }
}

export function isComputingDerivation() {
    return globalState.trackingDerivation !== null; // filter out actions inside computations
}

export function checkIfStateModificationsAreAllowed(atom: IAtom) {
    if (!window.__DEV__) {
        return;
    }
    const hasObservers = atom.observers_.size > 0;
    // Should not be possible to change observed state outside strict mode, except during initialization, see #563
    if (!globalState.allowStateChanges && (hasObservers || globalState.enforceActions === 'always'))
        console.warn(
            '[MobX] ' +
                (globalState.enforceActions
                    ? 'Since strict-mode is enabled, changing (observed) observable values without using an action is not allowed. Tried to modify: '
                    : "Side effects like changing state are not allowed at this point. Are you trying to modify state from, for example, a computed value or the render function of a React component? You can wrap side effects in 'runInAction' (or decorate functions with 'action') if needed. Tried to modify: ") +
                atom.name_
        );
}

export function checkIfStateReadsAreAllowed(observable: IObservable) {
    if (window.__DEV__ && !globalState.allowStateReads && globalState.observableRequiresReaction) {
        console.warn(`[mobx] Observable ${observable.name_} being read outside a reactive context`);
    }
}

/**
 * Executes the provided function `f` and tracks which observables are being accessed.
 * The tracking information is stored on the `derivation` object and the derivation is registered
 * as observer of any of the accessed observables.
 */
/**
 * derivation 观察者: Reaction
 * f 执行函数
 */
export function trackDerivedFunction<T>(derivation: IDerivation, f: () => T, context: any) {
    const prevAllowStateReads = allowStateReadsStart(true);
    // pre allocate array allocation + room for variation in deps
    // array will be trimmed by bindDependencies

    // 把 传入的 Reaction 和之前收集的被观察者状态都置为 UP_TO_DATE
    changeDependenciesStateTo0(derivation);
    derivation.newObserving_ = new Array(derivation.observing_.length + 100); // 用来存放这个reaction用到的observing对象
    derivation.unboundDepsCount_ = 0; // 记录新的依赖的数量
    derivation.runId_ = ++globalState.runId; // 每次执行都分配一个 uid
    // 将当前 trackingDerivation (观察者) 执行反应(派生) 取出来
    const prevTracking = globalState.trackingDerivation;
    // 当前 Derivation 记录到全局的 trackingDerivation 中，
    // 这样被观察的 Observable 在其 reportObserved 方法中就能获取到该 Derivation
    /*下面是observable对象的reportObser代码
            export function reportObserved(observable: IObservable): boolean {
            checkIfStateReadsAreAllowed(observable)

            const derivation = globalState.trackingDerivation 可以看到这里要使用全局对象trackingDerivation，下边是放入的地方
            console.log('reportObserved',derivation )
            if (derivation !== null) {
                
                    if (derivation.runId_ !== observable.lastAccessedBy_) {
                        observable.lastAccessedBy_ = derivation.runId_
                        // Tried storing newObserving, or observing, or both as Set, but performance didn't come close...
                        derivation.newObserving_![derivation.unboundDepsCount_++] = observable
                        if (!observable.isBeingObserved_ && globalState.trackingContext) {
                            observable.isBeingObserved_ = true
                            observable.onBO()
                        }
                    }
                    return true
                } else if (observable.observers_.size === 0 && globalState.inBatch > 0) {
                    queueForUnobservation(observable)
                }

                return false
            }

    */
    // 将新的传入 derivation (派生 | 观察者 Reaction) 绑定当前执行派生
    globalState.trackingDerivation = derivation; // 替换观察者
    // 接下来就要操作新的观察者和被观察者 依赖收集

    globalState.inBatch++; // 这里直接操作了事务。。。。为啥不是startBatch
    let result;
    if (globalState.disableErrorBoundaries === true) {
        // 执行reaction传递的的回调方法，翻看代码可以看出执行的是autoran函数的回调方法
        // 回调中一般会调用一或多个observable对象，触发observable.get方法, 再触发reportObserved方法
        // 调用函数访问被观察者, 触发被观察者get => reportObserved 绑定依赖到当前观察者newObserving_ 上
        result = f.call(context);
    } else {
        try {
            result = f.call(context);
        } catch (e) {
            result = new CaughtException(e);
        }
    }
    globalState.inBatch--;
    // 将之前观察者派生赋值回来, 当前观察者环境修改为之前的
    globalState.trackingDerivation = prevTracking;
    // 里面处理传入的观察者 derivation 和 被观察者关系, 被观察者observers_收集调用的观察者
    bindDependencies(derivation);

    warnAboutDerivationWithoutDependencies(derivation);
    allowStateReadsEnd(prevAllowStateReads);
    return result;
}

function warnAboutDerivationWithoutDependencies(derivation: IDerivation) {
    if (!window.__DEV__) return;

    if (derivation.observing_.length !== 0) return;

    if (globalState.reactionRequiresObservable || derivation.requiresObservable_) {
        console.warn(
            `[mobx] Derivation ${derivation.name_} is created/updated without reading any observable value`
        );
    }
}

/**
 * diffs newObserving with observing.
 * update observing to be newObserving with unique observables
 * notify observers that become observed/unobserved
 */
/**
 * 将newObserving变成observing, 一些失效的观察属性会被去掉, 新的加进去 (如: 方法里面存在if语句, 每次收集的依赖不一的情况)
 * @param derivation
 */
function bindDependencies(derivation: IDerivation) {
    // invariant(derivation.dependenciesState !== IDerivationState.NOT_TRACKING, "INTERNAL ERROR bindDependencies expects derivation.dependenciesState !== -1");
    const prevObserving = derivation.observing_;
    const observing = (derivation.observing_ = derivation.newObserving_!);
    let lowestNewObservingDerivationState = IDerivationState_.UP_TO_DATE_;

    // 可以看 ./bindDependencies-3-loop.png 图理解
    // Go through all new observables and check diffValue: (this list can contain duplicates):
    //   0: first occurrence, change to 1 and keep it
    //   1: extra occurrence, drop it
    /**
     * 遍历所有新的可观察对象并检查diffValue: 此列表可能包含重复的值
     * 0:第一次出现, 更改为1并保留它
     * 1:额外出现, 删除它
     */
    /**
     * 这里去重, 且将不相同的被观察者按顺序排列
     * [A,B,A,C,D,B] => [A,B,C,D,D,B]
     * 不同的安索引赋值, 后面不变
     * 所有diffValue_状态都为1
     */
    let i0 = 0,
        l = derivation.unboundDepsCount_;
    for (let i = 0; i < l; i++) {
        const dep = observing[i];
        if (dep.diffValue_ === 0) {
            dep.diffValue_ = 1;
            if (i0 !== i) observing[i0] = dep;
            i0++;
        }

        // Upcast is 'safe' here, because if dep is IObservable, `dependenciesState` will be undefined,
        // not hitting the condition
        if ((dep as any as IDerivation).dependenciesState_ > lowestNewObservingDerivationState) {
            lowestNewObservingDerivationState = (dep as any as IDerivation).dependenciesState_;
        }
    }
    observing.length = i0;

    derivation.newObserving_ = null; // newObserving shouldn't be needed outside tracking (statement moved down to work around FF bug, see #614)

    // Go through all old observables and check diffValue: (it is unique after last bindDependencies)
    //   0: it's not in new observables, unobserve it
    //   1: it keeps being observed, don't want to notify it. change to 0
    /**
     * 检查所有旧的可观察对象并检查diffValue: (最终bindDependencies之后是唯一)
     * 0:它不在 new observables中，不用观察
     * 1:它一直被观察, 不想通知它时候.  就更改为0
     */
    /**
     * 旧的依赖 prevObserving [A, B] => [1, 0]
     * 新的依赖 observing [A, C] => [1, 1]
     * 由于新的处理diffValue_都为1, 因此旧的prevObserving里A也被变成1, B在新的不存在, 因此没有改变
     * 移除prevObserving中 在 observing里没有的 B
     * 并且将diffValue_设置为0, 这个时候新observing里的A 变0
     * prevObserving里存在了新observing里存在的依赖(Observable)
     * observing里存在的, diffValue_为0不需要重复追加, diffValue_为1为新的依赖, 需要追加被观察者和观察者关系
     */
    l = prevObserving.length;
    while (l--) {
        const dep = prevObserving[l];
        if (dep.diffValue_ === 0) {
            removeObserver(dep, derivation);
        }
        dep.diffValue_ = 0;
    }

    // Go through all new observables and check diffValue: (now it should be unique)
    //   0: it was set to 0 in last loop. don't need to do anything.
    //   1: it wasn't observed, let's observe it. set back to 0
    /**
     * 遍历所有新的可观察对象并检查diffValue: (现在它应该是唯一的)
     * 0:在上次循环中被设置为0, 不需要做任何事情
     * 1:它没有被观察到, 让我们观察它, 设置回0
     */
    /**
     * [A]
     * [A, C]
     * 此时只需要建立C与R关系即可
     */
    while (i0--) {
        const dep = observing[i0];
        if (dep.diffValue_ === 1) {
            dep.diffValue_ = 0;
            // 在这里建立了observe对象与reaction对象的联系
            addObserver(dep, derivation);
        }
    }

    // Some new observed derivations may become stale during this derivation computation
    // so they have had no chance to propagate staleness (#916)
    if (lowestNewObservingDerivationState !== IDerivationState_.UP_TO_DATE_) {
        derivation.dependenciesState_ = lowestNewObservingDerivationState;
        derivation.onBecomeStale_();
    }
}

export function clearObserving(derivation: IDerivation) {
    // invariant(globalState.inBatch > 0, "INTERNAL ERROR clearObserving should be called only inside batch");
    const obs = derivation.observing_;
    derivation.observing_ = [];
    let i = obs.length;
    while (i--) removeObserver(obs[i], derivation);

    derivation.dependenciesState_ = IDerivationState_.NOT_TRACKING_;
}

export function untracked<T>(action: () => T): T {
    const prev = untrackedStart();
    try {
        return action();
    } finally {
        untrackedEnd(prev);
    }
}

export function untrackedStart(): IDerivation | null {
    const prev = globalState.trackingDerivation;
    globalState.trackingDerivation = null;
    return prev;
}

export function untrackedEnd(prev: IDerivation | null) {
    globalState.trackingDerivation = prev;
}

export function allowStateReadsStart(allowStateReads: boolean) {
    const prev = globalState.allowStateReads;
    globalState.allowStateReads = allowStateReads;
    return prev;
}

export function allowStateReadsEnd(prev: boolean) {
    globalState.allowStateReads = prev;
}

/**
 * needed to keep `lowestObserverState` correct. when changing from (2 or 1) to 0
 *
 */
export function changeDependenciesStateTo0(derivation: IDerivation) {
    if (derivation.dependenciesState_ === IDerivationState_.UP_TO_DATE_) return;
    derivation.dependenciesState_ = IDerivationState_.UP_TO_DATE_;

    const obs = derivation.observing_;
    let i = obs.length;
    while (i--) obs[i].lowestObserverState_ = IDerivationState_.UP_TO_DATE_;
}
