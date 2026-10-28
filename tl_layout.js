/**
 * A fast tree layout for large timeline graphs.
 *
 * The general-purpose `dagre` layout takes tens of seconds (blocking the whole UI) on graphs with
 * tens of thousands of nodes, which is what you get for a character with many long chats.
 * A timeline graph is (nearly) a tree, though: each message continues exactly one previous message,
 * except for the rare canned reply shared by several branches. Laying out a tree takes linear time.
 *
 * The result looks like dagre with `align: 'UL'`: each timeline continues in a straight line,
 * and branches are stacked next to it. Nodes with several parents are placed under their first parent.
 *
 * Supports the same `rankDir`, `nodeSep`, `rankSep` and `spacingFactor` options as the dagre layout config,
 * so the rest of the code can use either layout interchangeably.
 */

const defaults = {
    rankDir: 'LR',  // 'LR' or 'TB'
    nodeSep: 50,  // Separation between adjacent nodes in the same rank
    rankSep: 50,  // Separation between each rank
    spacingFactor: 1,
    nodeWidth: 25,
    nodeHeight: 25,
    fit: true,
    padding: 30,
    animate: false,
};

function TimelinesTreeLayout(options) {
    this.options = Object.assign({}, defaults, options);
}

TimelinesTreeLayout.prototype.run = function () {
    const options = this.options;
    const nodes = options.eles.nodes();
    const edges = options.eles.edges();
    const nodeIds = new Set(nodes.map(node => node.id()));

    // Build the tree: the first incoming edge of each node determines its parent.
    const children = new Map();  // id -> [child ids], in edge creation order
    const hasParent = new Set();
    edges.forEach(edge => {
        const source = edge.data('source');
        const target = edge.data('target');
        if (!nodeIds.has(source) || !nodeIds.has(target) || hasParent.has(target)) {
            return;
        }
        hasParent.add(target);
        if (!children.has(source)) {
            children.set(source, []);
        }
        children.get(source).push(target);
    });

    // Depth-first walk from each root (normally there is just one, the 'root' node).
    // Rank is the depth in the tree. Each leaf gets the next free slot on the cross axis,
    // and each parent gets the slot of its first child, so that timelines run in straight lines.
    const rank = new Map();
    const slot = new Map();
    let nextSlot = 0;
    const roots = nodes.filter(node => !hasParent.has(node.id())).map(node => node.id());
    for (const rootId of roots) {
        const stack = [[rootId, 0, false]];  // [id, rank, childrenVisited]
        while (stack.length > 0) {
            const [id, r, childrenVisited] = stack.pop();
            const kids = children.get(id) || [];
            if (!childrenVisited) {
                if (rank.has(id)) {  // already placed (only possible with malformed input that has cycles)
                    continue;
                }
                rank.set(id, r);
                stack.push([id, r, true]);
                for (let i = kids.length - 1; i >= 0; i--) {  // reversed, so the first child is visited first
                    if (!rank.has(kids[i])) {
                        stack.push([kids[i], r + 1, false]);
                    }
                }
            } else {
                const firstPlacedChild = kids.find(kid => slot.has(kid));
                if (firstPlacedChild !== undefined) {
                    slot.set(id, slot.get(firstPlacedChild));
                } else {
                    slot.set(id, nextSlot);
                    nextSlot += 1;
                }
            }
        }
    }
    // Anything unreachable (cycles) goes at the end, at rank 0.
    nodes.forEach(node => {
        if (!slot.has(node.id())) {
            rank.set(node.id(), 0);
            slot.set(node.id(), nextSlot);
            nextSlot += 1;
        }
    });

    const spacing = Number(options.spacingFactor) || 1;
    const nodeWidth = Number(options.nodeWidth);
    const nodeHeight = Number(options.nodeHeight);
    const isLR = (options.rankDir === 'LR');
    const rankStep = ((isLR ? nodeWidth : nodeHeight) + Number(options.rankSep)) * spacing;
    const slotStep = ((isLR ? nodeHeight : nodeWidth) + Number(options.nodeSep)) * spacing;

    nodes.layoutPositions(this, options, function (node) {
        const along = rank.get(node.id()) * rankStep;
        const across = slot.get(node.id()) * slotStep;
        return isLR ? { x: along, y: across } : { x: across, y: along };
    });
    return this;
};

TimelinesTreeLayout.prototype.stop = function () {
    return this;  // Synchronous layout; nothing to stop.
};

let isRegistered = false;

/**
 * Registers the 'timelinesTree' layout with Cytoscape. Safe to call more than once.
 *
 * @param {Function} cytoscape - The Cytoscape library function.
 */
export function registerTimelinesTreeLayout(cytoscape) {
    if (!isRegistered) {
        cytoscape('layout', 'timelinesTree', TimelinesTreeLayout);
        isRegistered = true;
    }
}
