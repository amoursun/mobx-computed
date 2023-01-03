import {
    $mobx,
    IDerivation,
    IDerivationState_,
    IObservable,
    Lambda,
    TraceMode,
    clearObserving,
    createInstanceofPredicate,
    endBatch,
    getNextId,
    globalState,
    isCaughtException,
    isSpyEnabled,
    shouldCompute,
    spyReport,
    spyReportEnd,
    spyReportStart,
    startBatch,
    trace,
    trackDerivedFunction,
} from '../internal';

/**
 * Reactions are a special kind of derivations. Several things distinguishes them from normal reactive computations
 *
 * 1) They will always run, whether they are used by other computations or not.
 * This means that they are very suitable for triggering side effects like logging, updating the DOM and making network requests.
 * 2) They are not observable themselves
 * 3) They will always run after any 'normal' derivations
 * 4) They are allowed to change the state and thereby triggering themselves again, as long as they make sure the state propagates to a stable state in a reasonable amount of iterations.
 *
 * The state machine of a Reaction is as follows:
 *
 * 1) after creating, the reaction should be started by calling `runReaction` or by scheduling it (see also `autorun`)
 * 2) the `onInvalidate` handler should somehow result in a call to `this.track(someFunction)`
 * 3) all observables accessed in `someFunction` will be observed by this reaction.
 * 4) as soon as some of the dependencies has changed the Reaction will be rescheduled for another run (after the current mutation or transaction). `isScheduled` will yield true once a dependency is stale and during this period
 * 5) `onInvalidate` will be called, and we are back at step 1.
 *
 */

export interface IReactionPublic {
    dispose(): void;
    trace(enterBreakPoint?: boolean): void;
}

export interface IReactionDisposer {
    (): void;
    $mobx: Reaction;
}

export class Reaction implements IDerivation, IReactionPublic {
    observing_: IObservable[] = []; // nodes we are looking at. Our value depends on these nodes
    newObserving_: IObservable[] = [];
    dependenciesState_ = IDerivationState_.NOT_TRACKING_;
    diffValue_ = 0;
    runId_ = 0;
    unboundDepsCount_ = 0;
    mapid_ = '#' + getNextId();
    isDisposed_ = false;
    isScheduled_ = false;
    isTrackPending_ = false;
    isRunning_ = false;
    isTracing_: TraceMode = TraceMode.NONE;

    /*
        这里关于onInvalidate_有一些思考，为什么autorun直接调用的track 而mobx-react 是讲track分开了
    
    */
    constructor(
        public name_: string = 'Reaction@' + getNextId(),
        private onInvalidate_: () => void, // 执行响应时调用的副作用函数
        private errorHandler_?: (error: any, derivation: IDerivation) => void,
        public requiresObservable_ = false
    ) {}

    /// state 陈旧  这里理解为过期，也就是要立刻执行这一批任务了
    onBecomeStale_() {
        this.schedule_();
    }
    // schedule 日程
    schedule_() {
        // Reaction 已经在重新计算的计划表内，直接返回
        if (!this.isScheduled_) {
            this.isScheduled_ = true;
            // 计划表维护了一个全局的数组，里面存的 Reactions 就是该 batch（批次） 中需要执行的 Reaction。
            globalState.pendingReactions.push(this);
            runReactions();
        }
    }

    isScheduled() {
        return this.isScheduled_;
    }

    /**
     * internal, use schedule() if you intend to kick off a reaction
     */
    runReaction_() {
        if (!this.isDisposed_) {
            // 开启一个事务处理, 因为运行 this.onInvalidate_() 的过程中可能会再加Reaction到计划中（如依赖更新）
            startBatch();
            this.isScheduled_ = false;
            // 判断 Reaction 收集的依赖状态
            // 在 NO_TRACKING | STALE | 判断 COMPUTED 值变化时才会执行 Reaction
            if (shouldCompute(this)) {
                this.isTrackPending_ = true;

                try {
                    this.onInvalidate_(); // 如果执行到这里 要执行这个reaction的响应了
                    if (window.__DEV__ && this.isTrackPending_ && isSpyEnabled()) {
                        // onInvalidate didn't trigger track right away..
                        spyReport({
                            name: this.name_,
                            type: 'scheduled-reaction',
                        });
                    }
                } catch (e) {
                    this.reportExceptionInDerivation_(e);
                }
            }
            endBatch();
        }
    }
    // track 追踪
    track(fn: () => void) {
        if (this.isDisposed_) {
            return;
            // console.warn("Reaction already disposed") // Note: Not a warning / error in mobx 4 either
        }
        startBatch(); // 启动一个事务
        const notify = isSpyEnabled();
        let startTime;
        if (window.__DEV__ && notify) {
            startTime = Date.now();
            spyReportStart({
                name: this.name_,
                type: 'reaction',
            });
        }
        this.isRunning_ = true;
        const prevReaction = globalState.trackingContext; // reactions could create reactions...
        globalState.trackingContext = this;
        // 这里把这个reaction放在全局，方便给observable收集obsers
        const result = trackDerivedFunction(this, fn, undefined);
        globalState.trackingContext = prevReaction;
        this.isRunning_ = false;
        this.isTrackPending_ = false;
        if (this.isDisposed_) {
            // disposed during last run. Clean up everything that was bound after the dispose call.
            clearObserving(this);
        }
        if (isCaughtException(result)) this.reportExceptionInDerivation_(result.cause);
        if (window.__DEV__ && notify) {
            spyReportEnd({
                time: Date.now() - startTime,
            });
        }
        endBatch();
    }

    reportExceptionInDerivation_(error: any) {
        if (this.errorHandler_) {
            this.errorHandler_(error, this);
            return;
        }

        if (globalState.disableErrorBoundaries) throw error;

        const message = window.__DEV__
            ? `[mobx] Encountered an uncaught exception that was thrown by a reaction or observer component, in: '${this}'`
            : `[mobx] uncaught error in '${this}'`;
        if (!globalState.suppressReactionErrors) {
            console.error(message, error)
            /** If debugging brought you here, please, read the above message :-). Tnx! */
        } else if (window.__DEV__) console.warn(`[mobx] (error in reaction '${this.name_}' suppressed, fix error of causing action below)`) // prettier-ignore

        if (window.__DEV__ && isSpyEnabled()) {
            spyReport({
                type: 'error',
                name: this.name_,
                message,
                error: '' + error,
            });
        }

        globalState.globalReactionErrorHandlers.forEach(f => f(error, this));
    }

    dispose() {
        if (!this.isDisposed_) {
            this.isDisposed_ = true;
            if (!this.isRunning_) {
                // if disposed while running, clean up later. Maybe not optimal, but rare case
                startBatch();
                clearObserving(this);
                endBatch();
            }
        }
    }

    getDisposer_(): IReactionDisposer {
        const r = this.dispose.bind(this) as IReactionDisposer;
        r[$mobx] = this;
        return r;
    }

    toString() {
        return `Reaction[${this.name_}]`;
    }

    trace(enterBreakPoint: boolean = false) {
        trace(this, enterBreakPoint);
    }
}

export function onReactionError(handler: (error: any, derivation: IDerivation) => void): Lambda {
    globalState.globalReactionErrorHandlers.push(handler);
    return () => {
        const idx = globalState.globalReactionErrorHandlers.indexOf(handler);
        if (idx >= 0) globalState.globalReactionErrorHandlers.splice(idx, 1);
    };
}

/**
 * Magic number alert!
 * Defines within how many times a reaction is allowed to re-trigger itself
 * until it is assumed that this is gonna be a never ending loop...
 */
const MAX_REACTION_ITERATIONS = 100;

let reactionScheduler: (fn: () => void) => void = f => f();

export function runReactions() {
    // Trampolining, if runReactions are already running, new reactions will be picked up
    //  // 惰性更新，若此时处于事务中，inBatch > 0，会直接返回
    if (globalState.inBatch > 0 || globalState.isRunningReactions) return;
    reactionScheduler(runReactionsHelper);
}

function runReactionsHelper() {
    globalState.isRunningReactions = true;
    // 取出当前批次收集的所有 Reaction
    const allReactions = globalState.pendingReactions;
    let iterations = 0;

    // While running reactions, new reactions might be triggered.
    // Hence we work with two variables and check whether
    // we converge to no remaining reactions after a while.
    // 当执行 Reaction 时，可能触发新的 Reaction(Reaction 内允许设置 Observable的值)，加入到 pendingReactions 中
    while (allReactions.length > 0) {
        if (++iterations === MAX_REACTION_ITERATIONS) {
            console.error(
                window.__DEV__
                    ? `Reaction doesn't converge to a stable state after ${MAX_REACTION_ITERATIONS} iterations.` +
                          ` Probably there is a cycle in the reactive function: ${allReactions[0]}`
                    : `[mobx] cycle in reaction: ${allReactions[0]}`
            );
            allReactions.splice(0); // clear reactions
        }
        let remainingReactions = allReactions.splice(0);
        for (let i = 0, l = remainingReactions.length; i < l; i++)
            remainingReactions[i].runReaction_();
    }
    globalState.isRunningReactions = false;
}

export const isReaction = createInstanceofPredicate('Reaction', Reaction);

export function setReactionScheduler(fn: (f: () => void) => void) {
    const baseScheduler = reactionScheduler;
    reactionScheduler = f => fn(() => baseScheduler(f));
}
