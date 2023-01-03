import {
    Lambda,
    ComputedValue,
    IDependencyTree,
    IDerivation,
    IDerivationState_,
    TraceMode,
    getDependencyTree,
    globalState,
    runReactions,
    checkIfStateReadsAreAllowed,
} from '../internal';

export interface IDepTreeNode {
    name_: string;
    observing_?: IObservable[];
}

export interface IObservable extends IDepTreeNode {
    diffValue_: number;
    /**
     * Id of the derivation *run* that last accessed this observable.
     * If this id equals the *run* id of the current derivation,
     * the dependency is already established
     */
    lastAccessedBy_: number;
    isBeingObserved_: boolean;

    lowestObserverState_: IDerivationState_; // Used to avoid redundant propagations
    isPendingUnobservation_: boolean; // Used to push itself to global.pendingUnobservations at most once per batch.

    observers_: Set<IDerivation>;

    onBUO(): void;
    onBO(): void;

    onBUOL: Set<Lambda> | undefined;
    onBOL: Set<Lambda> | undefined;
}

export function hasObservers(observable: IObservable): boolean {
    return observable.observers_ && observable.observers_.size > 0;
}

export function getObservers(observable: IObservable): Set<IDerivation> {
    return observable.observers_;
}

// function invariantObservers(observable: IObservable) {
//     const list = observable.observers
//     const map = observable.observersIndexes
//     const l = list.length
//     for (let i = 0; i < l; i++) {
//         const id = list[i].__mapid
//         if (i) {
//             invariant(map[id] === i, "INTERNAL ERROR maps derivation.__mapid to index in list") // for performance
//         } else {
//             invariant(!(id in map), "INTERNAL ERROR observer on index 0 shouldn't be held in map.") // for performance
//         }
//     }
//     invariant(
//         list.length === 0 || Object.keys(map).length === list.length - 1,
//         "INTERNAL ERROR there is no junk in map"
//     )
// }
export function addObserver(observable: IObservable, node: IDerivation) {
    // invariant(node.dependenciesState !== -1, "INTERNAL ERROR, can add only dependenciesState !== -1");
    // invariant(observable._observers.indexOf(node) === -1, "INTERNAL ERROR add already added node");
    // invariantObservers(observable);

    observable.observers_.add(node);
    if (observable.lowestObserverState_ > node.dependenciesState_)
        observable.lowestObserverState_ = node.dependenciesState_;

    // invariantObservers(observable);
    // invariant(observable._observers.indexOf(node) !== -1, "INTERNAL ERROR didn't add node");
}

export function removeObserver(observable: IObservable, node: IDerivation) {
    // invariant(globalState.inBatch > 0, "INTERNAL ERROR, remove should be called only inside batch");
    // invariant(observable._observers.indexOf(node) !== -1, "INTERNAL ERROR remove already removed node");
    // invariantObservers(observable);
    observable.observers_.delete(node);
    if (observable.observers_.size === 0) {
        // deleting last observer
        queueForUnobservation(observable);
    }
    // invariantObservers(observable);
    // invariant(observable._observers.indexOf(node) === -1, "INTERNAL ERROR remove already removed node2");
}

export function queueForUnobservation(observable: IObservable) {
    if (observable.isPendingUnobservation_ === false) {
        // invariant(observable._observers.length === 0, "INTERNAL ERROR, should only queue for unobservation unobserved observables");
        observable.isPendingUnobservation_ = true;
        globalState.pendingUnobservations.push(observable);
    }
}

/*
    引用了数据库事务的概念，Mobx 中的事务用于批量处理 Reaction（Derivation 管理者） 的执行，
    避免不必要的重新计算。Mobx 的事务实现比较简单，使用 startBatch 和 endBatch 来开始和结束一个事务：

    例如，一个 Action 开始和结束时同时伴随着事务的启动和结束，确保 Action 中（可能多次）对状态的修改只触发一次 Reaction 的重新执行。


*/

/**
 * Batch starts a transaction, at least for purposes of memoizing ComputedValues when nothing else does.
 *  批处理启动一个事务，至少是为了在没有其他操作的情况下记忆 ComputedValues。
 * During a batch `onBecomeUnobserved` will be called at most once per observable.
 * 在批处理期间，每个可观察对象最多调用一次“onBecomeUnobserved”。
 * Avoids unnecessary recalculations.
 *避免不必要的重新计算。
 */
export function startBatch() {
    globalState.inBatch++;
}

export function endBatch() {
    if (--globalState.inBatch === 0) {
        runReactions();
        // the batch is actually about to finish, all unobserving should happen here.
        const list = globalState.pendingUnobservations;
        for (let i = 0; i < list.length; i++) {
            const observable = list[i];
            observable.isPendingUnobservation_ = false;
            if (observable.observers_.size === 0) {
                if (observable.isBeingObserved_) {
                    // if this observable had reactive observers, trigger the hooks
                    observable.isBeingObserved_ = false;
                    observable.onBUO();
                }
                if (observable instanceof ComputedValue) {
                    // computed values are automatically teared down when the last observer leaves
                    // this process happens recursively, this computed might be the last observabe of another, etc..
                    observable.suspend_();
                }
            }
        }
        globalState.pendingUnobservations = [];
    }
}

// 报告被观察者放入 Derivation(R)newObserving_ 依赖 中
export function reportObserved(observable: IObservable): boolean {
    checkIfStateReadsAreAllowed(observable);

    // 当前运行的Derivation
    const derivation = globalState.trackingDerivation;
    console.log('reportObserved', derivation);
    if (derivation !== null) {
        /**
         * Simple optimization, give each derivation run an unique id (runId)
         * Check if last time this observable was accessed the same runId is used
         * if this is the case, the relation is already known
         */
        if (derivation.runId_ !== observable.lastAccessedBy_) {
            observable.lastAccessedBy_ = derivation.runId_;
            // Tried storing newObserving, or observing, or both as Set, but performance didn't come close...
            derivation.newObserving_![derivation.unboundDepsCount_++] = observable;
            if (!observable.isBeingObserved_ && globalState.trackingContext) {
                observable.isBeingObserved_ = true;
                observable.onBO();
            }
        }
        return true;
    } else if (observable.observers_.size === 0 && globalState.inBatch > 0) {
        queueForUnobservation(observable);
    }

    return false;
}

// function invariantLOS(observable: IObservable, msg: string) {
//     // it's expensive so better not run it in produciton. but temporarily helpful for testing
//     const min = getObservers(observable).reduce((a, b) => Math.min(a, b.dependenciesState), 2)
//     if (min >= observable.lowestObserverState) return // <- the only assumption about `lowestObserverState`
//     throw new Error(
//         "lowestObserverState is wrong for " +
//             msg +
//             " because " +
//             min +
//             " < " +
//             observable.lowestObserverState
//     )
// }

/**
 * NOTE: current propagation mechanism will in case of self reruning autoruns behave unexpectedly
 * It will propagate changes to observers from previous run
 * It's hard or maybe impossible (with reasonable perf) to get it right with current approach
 * Hopefully self reruning autoruns aren't a feature people should depend on
 * Also most basic use cases should be ok
 */

// Called by Atom when its value changes
// 通知改变, 改变状态为过期状态
export function propagateChanged(observable: IObservable) {
    // invariantLOS(observable, "changed start");
    if (observable.lowestObserverState_ === IDerivationState_.STALE_) return;
    // 标记数据发生了更新
    observable.lowestObserverState_ = IDerivationState_.STALE_;

    // Ideally we use for..of here, but the downcompiled version is really slow...
    observable.observers_.forEach(d => {
        // UP_TO_DATE 表示该观察者依赖的数据没有发生变化
        if (d.dependenciesState_ === IDerivationState_.UP_TO_DATE_) {
            if (window.__DEV__ && d.isTracing_ !== TraceMode.NONE) {
                logTraceInfo(d, observable);
            }
            d.onBecomeStale_();
        }
        // STALE 表示依赖的数据发生了变化，需要重新计算
        d.dependenciesState_ = IDerivationState_.STALE_;
    });
    // invariantLOS(observable, "changed end");
}

// Called by ComputedValue when it recalculate and its value changed
// 当它重新计算并值改变时，由ComputedValue调用 (computedValue 里调用)
// 计算值确实变化, 通知 POSSIBLY_STALE_ 变为 STALE_
export function propagateChangeConfirmed(observable: IObservable) {
    // invariantLOS(observable, "confirmed start");
    // 已经是 STALE_ 了, 不用修改了
    if (observable.lowestObserverState_ === IDerivationState_.STALE_) return;
    // ComputedValue 作为 Observable, 改变自身状态与其收集的 Derivation 都为不稳定态
    // 修改 lowestObserverState 为 STALE
    observable.lowestObserverState_ = IDerivationState_.STALE_;

    observable.observers_.forEach(d => {
        // POSSIBLY_STALE_ => STALE_
        /**
         * ObservableValue 发生变化时, 会执行propagateChanged代码, 将会遍历每个观察者, 执行观察者的 onBecomeStale 方法
         */
        if (d.dependenciesState_ === IDerivationState_.POSSIBLY_STALE_) {
            d.dependenciesState_ = IDerivationState_.STALE_;
        }
        // this happens during computing of `d`, just keep lowestObserverState up to date.
        // 这发生在计算 d 期间(依赖收集期间), 只要保持 lowestObserverState 是最新的
        else if (d.dependenciesState_ === IDerivationState_.UP_TO_DATE_) {
            observable.lowestObserverState_ = IDerivationState_.UP_TO_DATE_;
        }
    });
    // invariantLOS(observable, "confirmed end");
}

// Used by computed when its dependency changed, but we don't wan't to immediately recompute.
/**
 * 使用computed当它的依赖关系改变时，但我们不希望立即重新计算
 * 通知可能改变 (但不是立即改变) 改变状态 POSSIBLY_STALE_
 * ComputedValue 的 onBecomeStale 将 UP_TO_DATE 变成 POSSIBLY_STALE, 如此 propagateChangeConfirmed 方法将
 * POSSIBLY_STALE 变成 STALE
 * @param observable: => ComputedValue
 * @returns
 */
export function propagateMaybeChanged(observable: IObservable) {
    // invariantLOS(observable, "maybe start");
    if (observable.lowestObserverState_ !== IDerivationState_.UP_TO_DATE_) return;
    /**
     * 代表计算值可能会有变更, 这个状态只有计算值有
     * 观察者 & 被观察者, 依赖的对象有变化自己需感知, 同时自己的值一旦有变化, 也要通知依赖自己的observers_
     *  所以此时需要有一个中间状态可能改变, 只有计算值真正改变了才会让observers_执行动作, 这里是一个性能优化
     */
    observable.lowestObserverState_ = IDerivationState_.POSSIBLY_STALE_;

    observable.observers_.forEach(d => {
        if (d.dependenciesState_ === IDerivationState_.UP_TO_DATE_) {
            // 观察者的状态 dependenciesState 变为 POSSIBLY_STALE_，表示观察者们可能需要重新执行自己的逻辑
            d.dependenciesState_ = IDerivationState_.POSSIBLY_STALE_;
            if (window.__DEV__ && d.isTracing_ !== TraceMode.NONE) {
                logTraceInfo(d, observable);
            }
            // R加等待处理
            d.onBecomeStale_();
        }
    });
    // invariantLOS(observable, "maybe end");
}

function logTraceInfo(derivation: IDerivation, observable: IObservable) {
    console.log(
        `[mobx.trace] '${derivation.name_}' is invalidated due to a change in: '${observable.name_}'`
    );
    if (derivation.isTracing_ === TraceMode.BREAK) {
        const lines = [];
        printDepTree(getDependencyTree(derivation), lines, 1);

        // prettier-ignore
        new Function(
`debugger;
/*
Tracing '${derivation.name_}'

You are entering this break point because derivation '${derivation.name_}' is being traced and '${observable.name_}' is now forcing it to update.
Just follow the stacktrace you should now see in the devtools to see precisely what piece of your code is causing this update
The stackframe you are looking for is at least ~6-8 stack-frames up.

${derivation instanceof ComputedValue ? derivation.derivation.toString().replace(/[*]\//g, "/") : ""}

The dependencies for this derivation are:

${lines.join("\n")}
*/
    `)()
    }
}

function printDepTree(tree: IDependencyTree, lines: string[], depth: number) {
    if (lines.length >= 1000) {
        lines.push('(and many more)');
        return;
    }
    lines.push(`${new Array(depth).join('\t')}${tree.name}`); // MWE: not the fastest, but the easiest way :)
    if (tree.dependencies)
        tree.dependencies.forEach(child => printDepTree(child, lines, depth + 1));
}
